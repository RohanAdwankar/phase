import * as THREE from "three"
import { makePost } from "./post"
import { makeSky, SUN, skyTime } from "./sky"
import { flashTexture } from "./textures"
import { makeFx } from "./fx"
import { Enemy, Kind, makeEnemy } from "./actors"
import { makeViewmodel } from "./viewmodel"
import { makePistol } from "./pistol"
import { makeSword } from "./sword"
import { N, terrainY, track } from "./materials"
import { gradient } from "./toon"
import { createSfx, makeSfx } from "./audio"
import { buildChunk, buildDetail, disposeChunk, disposeDetail, loadWorld, LOAD_STEPS, chunkKey, clearRock, ellBox, hash, diff, Box, Chunk, CH } from "./world"
import { BOULDERS } from "./rocks"
import { registry, uTime, uPlayer } from "./materials"

const V = THREE.Vector3
type Axis = "x" | "y" | "z"
const DT = 1 / 120, G = 24, SPEED = 10
const ORANGE = new THREE.Color(0xff9a30), DUST = new THREE.Color(0xe8d9b0)
const GLOW = [0x33ccff, 0xffcc44, 0x44ffaa, 0xff6644, 0xaa88ff]

const rayBox = (o: THREE.Vector3, d: THREE.Vector3, mn: THREE.Vector3, mx: THREE.Vector3) => {
  let t0 = 0, t1 = Infinity
  for (const a of ["x", "y", "z"] as Axis[]) {
    let a0 = (mn[a] - o[a]) / d[a], a1 = (mx[a] - o[a]) / d[a]
    if (a0 > a1) [a0, a1] = [a1, a0]
    t0 = Math.max(t0, a0); t1 = Math.min(t1, a1)
    if (t0 > t1) return Infinity
  }
  return t0
}

// ray against a collider: boulders are real ellipsoids (so arrows never stick to empty corners), everything else an axis-aligned box
const rayCollider = (o: THREE.Vector3, d: THREE.Vector3, b: Box) => {
  if (!b.ell) return rayBox(o, d, b.min, b.max)
  const e = b.ell, ox = (o.x - e.cx) / e.rx, oy = (o.y - e.cy) / e.hh, oz = (o.z - e.cz) / e.rz, dx = d.x / e.rx, dy = d.y / e.hh, dz = d.z / e.rz
  const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), C = ox * ox + oy * oy + oz * oz - 1, disc = B * B - 4 * A * C
  if (disc < 0) return Infinity
  const t = (-B - Math.sqrt(disc)) / (2 * A)
  return t > 0 && o.y + d.y * t > e.bot ? t : C < 0 ? 0 : Infinity
}

export async function startGame(canvas: HTMLCanvasElement, hud: HTMLCanvasElement, signal: AbortSignal, status: (frac: number, label: string) => void) {
  const idle = { stop: () => {}, tutorial: () => {} }
  if (signal.aborted) return idle
  const ctx = hud.getContext("2d")!
  let loaded = 0; status(0, "loading textures and plants")
  const world = await loadWorld(() => status(0.7 * ++loaded / LOAD_STEPS, "loading textures and plants"))
  if (signal.aborted) return idle
  status(0.75, "building the renderer")
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  const scene = new THREE.Scene()
  scene.environmentIntensity = 0.9
  const sky = makeSky(700); sky.renderOrder = -1; scene.add(sky)
  // the reflection environment is the same painted sky over a green ground
  const envScene = new THREE.Scene(); envScene.add(makeSky(50))
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32), new THREE.MeshBasicMaterial({ color: 0x6b9a3a }))
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1; envScene.add(ground)
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.02).texture
  scene.fog = new THREE.FogExp2(0xbdd0e4, 0.0034)
  const cam = new THREE.PerspectiveCamera(85, 1, 0.05, 1000)
  cam.rotation.order = "YXZ"; scene.add(cam)
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x7a6a8a, 1.9))
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.4)
  sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 200 })
  renderer.shadowMap.autoUpdate = false
  scene.add(sun, sun.target)

  // viewmodel scene: same lighting and reflections as the world, its own camera
  const vmScene = new THREE.Scene(), vmCam = new THREE.PerspectiveCamera(70, 1, 0.02, 20); vmScene.add(vmCam)
  vmScene.environment = scene.environment; vmScene.environmentIntensity = 0.9
  vmScene.add(new THREE.HemisphereLight(0xcfe0ff, 0x7a6a8a, 1.9)); { const vs = new THREE.DirectionalLight(0xfff0d2, 2.4); vs.position.set(-0.4, 1, 0.5); vmScene.add(vs) }
  const post = makePost(renderer, scene, cam, vmScene, vmCam)

  const dbg = { freezeVm: false, showKeys: false, hideHud: false, hideStats: false, lockScale: 0 }
  const sfx = createSfx()
  const fx = makeFx(scene), bow = makeViewmodel(world.metal), pistol = makePistol(flashTexture(), world.metal)
  const sword = makeSword(world.metal)
  type Weapon = "pistol" | "bow" | "sword"
  let weapon: Weapon = "pistol"
  const swordPivot = new THREE.Group(); swordPivot.position.set(0, -0.4, 0); swordPivot.add(sword.root); swordPivot.visible = false
  vmCam.add(bow.root, pistol.root, swordPivot); bow.root.visible = false
  const swap = (w: Weapon) => { if (w === weapon) return; st.reload = 0; sfx.draw.stop(); sfx.play("tick"); weapon = w; st.draw = 0; st.swing = 0; st.fireT = 0.25; bow.root.visible = w === "bow"; pistol.root.visible = w === "pistol"; swordPivot.visible = w === "sword" }
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb04a).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6)

  const chunks = new Map<string, Chunk>()
  const genMs: number[] = []
  let budget = 0
  const st = { pos: new V(0, terrainY(0, 0) + 0.05, 0), vel: new V(), yaw: 0, pitch: 0, ground: false, jumps: 0, slide: false, coyote: 0,
    wallT: 0, wallCD: 0, contact: 0, wn: new V(), hp: 100, maxHp: 100, jumpBuf: 0, jumpFresh: false, hopT: 0, hops: 0, focus: null as { cx: number; cz: number; order: number[]; lit: boolean[]; next: number } | null, target: null as { cx: number; cz: number } | null, targetD: 0, bossE: null as Enemy | null, level: 0, boon: { dmg: 0, spd: 0, cd: 0 }, banner: "", bannerT: 0, kills: 0, fireT: 0, ammo: 12, reload: 0, tnt: 6, tntT: 0, items: 0, deadT: 0, deadLen: 1.9, inv: 0, respawnFx: 0, deaths: 0, cause: "", scrapeT: 0, stepD: 0, gCd: 0, tCd: 0, shake: 0, draw: 0, swing: 0, charge: 0, surge: 0, surgeLen: 1, surgeSpd: 0, surgeHit: new Set<unknown>(), spin: 0, sdir: new V(), hit: 0, hurt: 0, kick: 0, roll: 0, flash: 0, bob: 0,
    jump: false, fire: false, glide: false, lookX: 0, lookY: 0 }
  let d = 2, target = 2, best = 0, time = 0
  const keys = new Set<string>()
  const on = (c: string) => keys.has(c)
  // the dimensions form a ring: d and the wheel/Q/E target are unbounded, and every consumer reads the wrapped value
  const wrap = (x: number) => ((x % N) + N) % N, nd = () => Math.round(wrap(d)) % N, gap = (i: number) => { const x = Math.abs(i - wrap(d)); return Math.min(x, N - x) }
  const pc = () => [Math.floor(st.pos.x / CH), Math.floor(st.pos.z / CH)] as const
  const ring = (c: Chunk) => { const [x, z] = pc(); return Math.max(Math.abs(c.cx - x), Math.abs(c.cz - z)) }
  const nearChunks = (r: number) => [...chunks.values()].filter(c => ring(c) <= r)
  const nearBoxes = () => nearChunks(1).flatMap(c => c.boxes).filter(b => b.dim === nd())
  const groundH = (x: number, z: number) => {
    const c = chunks.get(chunkKey(Math.floor(x / CH), Math.floor(z / CH)))
    if (c) for (const q of c.pits) if (q.dim === nd() && x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1) return -Infinity
    return terrainY(x, z)
  }
  // boulder dome height under (x, z), inflated by the player radius; -Infinity outside it
  const R = 0.5
  const domeTop = (e: NonNullable<Box["ell"]>, x: number, z: number) => {
    const a = (x - e.cx) / (e.rx + R), c = (z - e.cz) / (e.rz + R), q = a * a + c * c
    return q >= 1 ? -Infinity : e.cy + e.hh * Math.sqrt(1 - q)
  }
  const over = (b: Box, h: number) => { const p = st.pos
    if (b.ell) { const t = domeTop(b.ell, p.x, p.z); return t > -Infinity && p.y + h > b.ell.bot && p.y < t }
    return p.x + R > b.min.x && p.x - R < b.max.x && p.y + h > b.min.y && p.y < b.max.y && p.z + R > b.min.z && p.z - R < b.max.z }
  const hitN = new V()
  const move = (axis: Axis, h: number, bx: Box[]) => {
    const v = st.vel[axis]; let n = 0
    const before = st.pos[axis]
    st.pos[axis] += v * DT
    for (const b of bx) if (over(b, h)) {
      if (b.ell) {
        const e = b.ell, top = domeTop(e, st.pos.x, st.pos.z)
        if (axis === "y") {
          if (v <= 0) { st.pos.y = top; n = 1 } else { st.pos.y = before; n = -1 }
        } else if (st.pos.y >= top - 0.5) st.pos.y = top
        else {
          // push back out to the inflated ellipse along this axis, on the side the player came from
          const c = axis === "x" ? e.cx : e.cz, other = axis === "x" ? (st.pos.z - e.cz) / (e.rz + R) : (st.pos.x - e.cx) / (e.rx + R), rad = axis === "x" ? e.rx + R : e.rz + R
          st.pos[axis] = c + Math.sign(before - c || 1) * rad * Math.sqrt(Math.max(0, 1 - other * other)) * 1.001
          n = Math.sign(before - c || 1); hitN.set((st.pos.x - e.cx) / (e.rx * e.rx), 0, (st.pos.z - e.cz) / (e.rz * e.rz)).normalize()
        }
        continue
      }
      const e = axis === "y" ? h : R
      st.pos[axis] = v > 0 ? b.min[axis] - e : b.max[axis] + (axis === "y" ? 0 : R)
      n = v > 0 ? -1 : 1
      if (axis !== "y") hitN.set(axis === "x" ? n : 0, 0, axis === "z" ? n : 0)
    }
    if (axis === "y" && v <= 0) { const gh = groundH(st.pos.x, st.pos.z); if (st.pos.y < gh) { st.pos.y = gh; n = 1 } }
    if (n) st.vel[axis] = 0
    return n
  }
  // when a phase leaves the player inside geometry, shove out through the nearest face
  const pushOut = (b: Box, h: number) => {
    const p = st.pos
    if (b.ell) { const dx = p.x - b.ell.cx, dz = p.z - b.ell.cz, l = Math.hypot(dx / (b.ell.rx + R), dz / (b.ell.rz + R)) || 1; p.x = b.ell.cx + (dx / l) * 1.02; p.z = b.ell.cz + (dz / l) * 1.02; return }
    const c = [b.max.x - (p.x - R), p.x + R - b.min.x, b.max.z - (p.z - R), p.z + R - b.min.z, b.max.y - p.y, p.y + h - b.min.y], k = c.indexOf(Math.min(...c))
    if (k === 0) p.x = b.max.x + R; else if (k === 1) p.x = b.min.x - R; else if (k === 2) p.z = b.max.z + R; else if (k === 3) p.z = b.min.z - R; else if (k === 4) p.y = b.max.y; else p.y = b.min.y - h
  }
  // phasing can leave the player inside rock. Launch them straight up out of it (or sideways out of a very tall wall) so a dimension change never traps them.
  const unstick = (bx: Box[], h: number) => {
    let hit = false
    for (let n = 0; n < 6; n++) {
      const b = bx.find(q => over(q, h)); if (!b) break
      hit = true
      const topY = b.ell ? domeTop(b.ell, st.pos.x, st.pos.z) : b.max.y, up = topY - st.pos.y + 0.4
      if (up <= 8) { st.pos.y = topY + 0.05; st.vel.y = Math.max(st.vel.y, 11 + up * 0.8) } else { pushOut(b, h); st.vel.y = Math.max(st.vel.y, 6) }
    }
    if (hit) { st.ground = false; st.jumps = 0; fx.spark(new V(st.pos.x, st.pos.y + 0.3, st.pos.z), 36, new V(0, 1, 0), DUST); fx.smoke(new V(st.pos.x, st.pos.y, st.pos.z), 4, DUST, 1) }
  }
  let checkpoint = { pos: st.pos.clone(), dim: 2 }, cpT = 0
  const die = (why: string) => {
    if (st.deadT > 0) return
    st.deadT = st.deadLen; st.cause = why; st.deaths++; st.fire = false; st.draw = 0; st.charge = 0; st.swing = 0; st.surge = 0
    sfx.draw.stop(); sfx.play("death"); fx.spark(new V(st.pos.x, st.pos.y + 1, st.pos.z), 50, new V(0, 1, 0), new THREE.Color(0xff4020))
  }
  const respawn = () => {
    st.pos.copy(checkpoint.pos).y += 0.3; st.vel.set(0, 0, 0); st.hp = st.maxHp; st.wallT = 0
    d = target = checkpoint.dim
    st.inv = 2.5; st.ammo = 12; st.reload = 0; st.respawnFx = 1.4; st.hurt = 0; hurts.length = 0; sfx.play("respawn")
  }

  const boom = new THREE.PointLight(0xffa040, 0, 30); scene.add(boom)
  const beams: { mesh: THREE.Mesh; life: number }[] = []
  const beam = (a: THREE.Vector3, b: THREE.Vector3, r: number, life: number) => {
    const mesh = new THREE.Mesh(beamGeo, beamMat), len = a.distanceTo(b)
    mesh.position.copy(a).lerp(b, 0.5); mesh.scale.set(r, len, r)
    mesh.quaternion.setFromUnitVectors(new V(0, 1, 0), b.clone().sub(a).normalize())
    scene.add(mesh); beams.push({ mesh, life })
  }
  const hitBox = (e: Enemy) => [new V(e.pos.x - e.hr, e.pos.y, e.pos.z - e.hr), new V(e.pos.x + e.hr, e.pos.y + e.h, e.pos.z + e.hr)] as const

  // bow: hold to draw, release to loose. Arrows fly on an arc, stick into whatever they hit, and only touch the dimension they were fired in.
  type Arrow = { mesh: THREE.Group; vel: THREE.Vector3; dim: number; power: number; life: number; stuck: boolean }
  const arrows: Arrow[] = []
  const arrowGeo = { shaft: new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6).rotateX(Math.PI / 2).translate(0, 0, 0.45), head: new THREE.ConeGeometry(0.03, 0.14, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.02) }
  const arrowMat = { shaft: new THREE.MeshStandardMaterial({ color: 0xc9a56a, roughness: 0.6 }), head: new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.25 }) }
  const loose = (power: number) => {
    sfx.draw.stop(); sfx.play("loose", undefined, 0.5 + 0.5 * power)
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    const mesh = new THREE.Group(); mesh.add(new THREE.Mesh(arrowGeo.shaft, arrowMat.shaft), new THREE.Mesh(arrowGeo.head, arrowMat.head))
    mesh.position.copy(o).addScaledVector(dir, 0.8).add(new V(0.12, -0.12, 0).applyQuaternion(cam.quaternion)); mesh.quaternion.setFromUnitVectors(new V(0, 0, -1), dir); scene.add(mesh)
    arrows.push({ mesh, vel: dir.clone().multiplyScalar(26 + 52 * power).add(st.vel.clone().multiplyScalar(0.35)), dim: nd(), power, life: 6, stuck: false })
    st.kick = 1.6
    // a fully drawn shot from the ground kicks you the opposite way: aim down to rocket straight up, aim a little low to be thrown far
    if (power >= 0.99 && (st.ground || st.coyote > 0)) {
      st.vel.addScaledVector(dir, -26); st.vel.y += 7; st.ground = false; st.coyote = 0; st.slide = false; st.shake = 0.7
      sfx.play("whoosh", undefined, 1.4); fx.spark(new V(st.pos.x, st.pos.y + 0.2, st.pos.z), 40, new V(0, 1, 0), DUST); fx.smoke(new V(st.pos.x, st.pos.y, st.pos.z), 6, DUST, 1.4)
    }
  }
  const MAG = 12, RELOAD = 1.2
  const startReload = () => { if (st.reload > 0 || st.ammo === MAG) return; st.reload = RELOAD; sfx.play("tick") }
  const shootPistol = () => {
    sfx.play("pistol"); st.ammo--
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    dir.x += (Math.random() - 0.5) * 0.012; dir.y += (Math.random() - 0.5) * 0.012; dir.normalize()
    let tMin = 150, hit: Enemy | null = null
    for (const c of chunks.values()) for (const b of c.boxes) if (b.dim === nd()) tMin = Math.min(tMin, rayCollider(o, dir, b))
    for (let t = 1; t < tMin; t += 1.5) if (o.y + dir.y * t < terrainY(o.x + dir.x * t, o.z + dir.z * t)) { tMin = t; break }
    for (const c of nearChunks(2)) for (const e of c.enemies) if (e.dim === nd()) {
      const t = rayBox(o, dir, ...hitBox(e))
      if (t < tMin) { tMin = t; hit = e }
    }
    const end = o.clone().addScaledVector(dir, tMin), mz = pistol.muzzle.getWorldPosition(new V()).applyMatrix4(cam.matrixWorld)
    if (hit) {
      st.hit = 0.12; hit.hitT = 0.14; sfx.play("hit", end); fx.spark(end, 10, dir.clone().negate(), ORANGE); fx.smoke(end, 1, DUST, 0.5)
      if ((hit.hp -= dm()) <= 0) {
        const c = hit.pos.clone().setY(hit.pos.y + 1.6)
        fx.spark(c, 90, new V(0, 1, 0), ORANGE); fx.smoke(c, 10, new THREE.Color(0x2a2a2a), 1.4); boom.position.copy(c); boom.intensity = weapon === "sword" ? 20 : 60; hit.mesh.removeFromParent(); st.kills++; onKill(hit)
        for (const c of nearChunks(2)) c.enemies = c.enemies.filter(e => e !== hit)
      }
    } else if (tMin < 150) { sfx.play("thud", end, 0.6); fx.spark(end, 6, dir.clone().negate(), DUST); fx.smoke(end, 2, DUST, 0.6) }
    beam(mz, end, 0.012, 0.05)
    const right = new V(1, 0, 0).applyQuaternion(cam.quaternion), up = new V(0, 1, 0).applyQuaternion(cam.quaternion)
    fx.casing(pistol.eject.clone().add(pistol.root.position).applyMatrix4(cam.matrixWorld), right.multiplyScalar(2 + Math.random()).addScaledVector(up, 1.5 + Math.random()).addScaledVector(st.vel, 0.3))
    st.kick = 1; st.flash = 0.05; pistol.flash.material.rotation = Math.random() * 6
  }
  // sword: tap to chop (upright blade, strike down, 0.45 s). Hold to charge and release to surge forward in a 360 cut; longer holds surge farther and faster.
  const SWING = 0.45, MAXCHARGE = 1.0
  const cutAt = (e: Enemy, dmg: number, shove: number) => {
    const dx = e.pos.x - st.pos.x, dz = e.pos.z - st.pos.z, dist = Math.max(0.01, Math.hypot(dx, dz)), c = new V(e.pos.x, e.pos.y + 1.7, e.pos.z)
    e.hp -= dmg * dm(); e.hitT = 0.2; e.pos.x += dx / dist * shove; e.pos.z += dz / dist * shove
    fx.spark(c, 12, new V(-dx / dist, 0.5, -dz / dist), ORANGE); fx.smoke(c, 1, DUST, 0.6)
    if (e.hp <= 0) killWalker(e)
  }
  const swingCut = () => {
    const p = st.pos, fwd = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)); let any = false
    for (const c of nearChunks(1)) for (const e of [...c.enemies]) {
      if (e.dim !== nd()) continue
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, dist = Math.hypot(dx, dz)
      if (dist > 6.5 + e.hr || (dist > 1.8 && (dx * fwd.x + dz * fwd.z) / dist < 0.1)) continue
      any = true; cutAt(e, 6, 1.2)
    }
    if (any) { st.hit = 0.15; st.kick = 1.4; sfx.play("hit") }
  }
  // the 360 cut: every walker of this dimension within reach of the player at any moment of the surge is cut once
  const surgeCut = () => {
    let any = false
    for (const c of nearChunks(2)) for (const e of [...c.enemies]) {
      if (e.dim !== nd() || st.surgeHit.has(e)) continue
      if (Math.hypot(e.pos.x - st.pos.x, e.pos.z - st.pos.z) > 5 + e.hr) continue
      st.surgeHit.add(e); any = true; cutAt(e, 9, 2.5)
    }
    if (any) { st.hit = 0.2; st.kick = 2; sfx.play("hit") }
  }
  const startSurge = (charge: number) => {
    const f = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)), dist = 5 + 16 * charge, dur = 0.26 + 0.2 * charge
    sfx.play("surge"); st.surge = 1; st.surgeLen = dur; st.surgeSpd = dist / dur; st.surgeHit.clear()
    st.sdir.copy(f); st.vel.y = Math.max(st.vel.y, 1.5); st.charge = 0
    { const back = new V(st.pos.x - f.x * 3, st.pos.y + 0.2, st.pos.z - f.z * 3); fx.spark(back, 8, f.clone().negate(), DUST); fx.smoke(back, 3, DUST, 1.2) }
  }
  // a dying walker blows up: a big burst that hurts neighbours, and any TNT it was standing on goes off too
  const dying = new Set<Enemy>()
  const killWalker = (e: Enemy, byPlayer = true) => {
    if (dying.has(e)) return
    dying.add(e)
    sfx.play("die", e.pos)
    e.mesh.removeFromParent(); if (byPlayer) { st.kills++; onKill(e) }
    for (const ch of chunks.values()) ch.enemies = ch.enemies.filter(x => x !== e)
    const c = e.pos.clone().setY(e.pos.y + 1.5)
    for (const b of bombs) if (b.kind === "tnt" && b.dim === e.dim && Math.hypot(b.pos.x - e.pos.x, b.pos.z - e.pos.z) < 3.6 && Math.abs(b.pos.y - e.pos.y) < 3) b.fuse = Math.min(b.fuse, 0.08)
    const big = { walker: [6.5, 9, 140], swarmer: [3.4, 5, 40], flyer: [5, 7, 90], brute: [10, 16, 260], boss: [16, 20, 420] }[e.kind]
    if (e.kind === "boss") bossDown(e)
    explode(c, e.dim, big[0], big[1], 0.7 + big[0] * 0.05, 0)
    fx.spark(c, big[2], new V(0, 1, 0), ORANGE); fx.smoke(c, Math.round(big[0] * 2), new THREE.Color(0x2a2a2a), big[0] * 0.34)
  }
  const arrowStep = (a: Arrow, dt: number) => {
    if (a.stuck) { a.life -= dt; return }
    a.life -= dt
    const p = a.mesh.position, dir = a.vel.clone().normalize(), len = a.vel.length() * dt, ch = nearChunks(3)
    let tMin = len, hit: Enemy | null = null
    for (const c of ch) for (const b of c.boxes) if (b.dim === a.dim) tMin = Math.min(tMin, rayCollider(p, dir, b))
    for (const c of ch) for (const e of c.enemies) if (e.dim === a.dim) { const t = rayBox(p, dir, ...hitBox(e)); if (t < tMin) { tMin = t; hit = e } }
    // a planted TNT pile is hit like a sphere sized to the pile; hitting it sets it off
    let tntHit: Bomb | null = null
    for (const bm of bombs) if (bm.kind === "tnt" && bm.dim === a.dim) {
      const rad = 1.0 + 0.24 * Math.sqrt(bm.n), cx = bm.pos.x - p.x, cy = bm.pos.y + 0.6 - p.y, cz = bm.pos.z - p.z, proj = cx * dir.x + cy * dir.y + cz * dir.z
      if (proj < 0 || proj > Math.min(tMin, len) + rad) continue
      if (cx * cx + cy * cy + cz * cz - proj * proj < rad * rad && proj - rad < tMin) { tMin = Math.max(0, proj - rad); tntHit = bm }
    }
    const end = p.clone().addScaledVector(dir, Math.min(tMin, len))
    const gy = terrainY(end.x, end.z), onTerrain = end.y < gy
    if (tMin < len || onTerrain) {
      a.stuck = true; a.life = 5; p.copy(end); if (onTerrain) p.y = gy
      if (tntHit) { (tntHit as Bomb).fuse = 0.05; a.life = 0; return }
      if (hit) { sfx.play("hit", end); st.hit = 0.15; hit.hitT = 0.14; hit.hp -= (4 + 12 * a.power * a.power) * dm(); fx.spark(end, 14, dir.clone().negate(), ORANGE); fx.smoke(end, 1, DUST, 0.5); if (hit.hp <= 0) killWalker(hit); a.life = 0 }
      else { sfx.play("thud", end, 0.7); fx.spark(end, 5, dir.clone().negate(), DUST); fx.smoke(end, 2, DUST, 0.6) }
      return
    }
    p.copy(end); a.vel.y -= 13 * dt; a.mesh.quaternion.setFromUnitVectors(new V(0, 0, -1), a.vel.clone().normalize())
  }

  const dm = () => 1 + 0.2 * st.boon.dmg, cdm = () => Math.pow(0.85, st.boon.cd)
  // kills heal by enemy size, and sometimes drop a powerup orb that stacks for the rest of the run
  const HEAL: Record<Kind, number> = { swarmer: 0.1, flyer: 0.1, walker: 0.2, brute: 0.5, boss: 1 }, DROP: Record<Kind, number> = { swarmer: 0.04, flyer: 0.1, walker: 0.14, brute: 0.4, boss: 0 }
  const orbs: { mesh: THREE.Mesh; pos: THREE.Vector3; dim: number; life: number }[] = [], orbGeo = new THREE.OctahedronGeometry(0.3), orbMat = new THREE.MeshBasicMaterial({ color: 0xffd36a })
  const POWERUPS: [string, () => void][] = [["damage +10%", () => { st.boon.dmg += 0.5 }], ["move speed +4%", () => { st.boon.spd += 0.5 }], ["cooldowns -8%", () => { st.boon.cd += 0.5 }], ["max health +10", () => { st.maxHp += 10 }]]
  const onKill = (e: Enemy) => {
    st.hp = Math.min(st.maxHp, st.hp + HEAL[e.kind] * st.maxHp)
    if (Math.random() < DROP[e.kind]) { const mesh = new THREE.Mesh(orbGeo, orbMat); mesh.position.copy(e.pos).setY(e.pos.y + 1); scene.add(mesh); orbs.push({ mesh, pos: mesh.position, dim: e.dim, life: 45 }) }
  }
  const orbTick = (dt: number) => {
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i], here = o.dim === nd(); o.life -= dt; o.mesh.visible = here; o.mesh.rotation.y += dt * 2.5
      const dx = st.pos.x - o.pos.x, dy = st.pos.y + 1 - o.pos.y, dz = st.pos.z - o.pos.z, dist = Math.hypot(dx, dy, dz)
      if (here && dist < 9) o.pos.addScaledVector(new V(dx, dy, dz), Math.min(1, 7 * dt / Math.max(dist, 0.1)))
      if (here && dist < 1.6 && st.deadT <= 0) { const [text, apply] = POWERUPS[Math.floor(Math.random() * POWERUPS.length)]; apply(); st.items++; banner(text, 1.6); sfx.play("ready"); fx.spark(o.pos, 20, new V(0, 1, 0), new THREE.Color(0xffd36a)); o.life = 0 }
      if (o.life <= 0) { o.mesh.removeFromParent(); orbs.splice(i, 1) }
    }
  }
  // each hit remembers where it came from in the world, so the flash can point at the shooter as the player turns
  const hurts: { x: number; z: number; t: number }[] = []
  // explosives: pistol alt-fire (G) throws a grenade, bow alt-fire (G) plants TNT. TNT in the same spot stacks and the blast compounds.
  type Bomb = { kind: "grenade" | "tnt"; mesh: THREE.Group; pos: THREE.Vector3; vel: THREE.Vector3; dim: number; fuse: number; n: number }
  const bombs: Bomb[] = [], waves: { mesh: THREE.Mesh; t: number; r: number }[] = []
  const waveGeo = new THREE.SphereGeometry(1, 24, 16), waveMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const tntMat = new THREE.MeshToonMaterial({ color: 0xd8321e, gradientMap: gradient }), bandMat = new THREE.MeshToonMaterial({ color: 0xf4eadb, gradientMap: gradient }), blackMat = new THREE.MeshToonMaterial({ color: 0x24262a, gradientMap: gradient })
  const fuseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa030).multiplyScalar(3), toneMapped: false })
  const gren = () => { const m = new THREE.Group(); m.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), new THREE.MeshToonMaterial({ color: 0x3f5a2c, gradientMap: gradient })), (() => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), fuseMat); s.position.set(0, 0.15, 0); return s })()); return m }
  const TS = 2 // TNT scale: crates are 0.84 m cubes
  const tntMesh = (n: number) => {
    const m = new THREE.Group()
    for (let k = 0; k < n; k++) {
      const s = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), tntMat), band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.44), bandMat), top = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), blackMat)
      top.position.y = 0.24; s.add(box, band, top)
      const a = k * 2.4, ring = Math.min(k, 1) * 0.3; s.position.set(Math.cos(a) * ring, 0.21 + Math.floor(k / 3) * 0.4, Math.sin(a) * ring); s.rotation.y = k * 0.9; m.add(s)
    }
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), fuseMat); sp.position.y = 0.3 + Math.floor((n - 1) / 3) * 0.4; sp.name = "spark"; m.add(sp)
    m.scale.setScalar(TS)
    return m
  }
  const explode = (pos: THREE.Vector3, dim: number, radius: number, dmg: number, shake: number, chain = radius * 0.7) => {
    for (const c of chunks.values()) for (const e of [...c.enemies]) {
      if (e.dim !== dim || Math.abs(e.pos.x - pos.x) > radius || Math.abs(e.pos.z - pos.z) > radius) continue
      const dx = e.pos.x - pos.x, dy = e.pos.y + 1.5 - pos.y, dz = e.pos.z - pos.z, dist = Math.hypot(dx, dy, dz)
      if (dist > radius) continue
      e.hp -= dmg * dm() * (1 - 0.65 * dist / radius); e.hitT = 0.25; const k = (1 - dist / radius) * 4 / Math.max(0.5, Math.hypot(dx, dz)); e.pos.x += dx * k; e.pos.z += dz * k
      if (e.hp <= 0) killWalker(e)
    }
    for (const b of bombs) if (b.kind === "tnt" && b.fuse > 0.12 && b.dim === dim && b.pos.distanceTo(pos) < chain && b.pos !== pos) b.fuse = 0.1 + Math.random() * 0.15
    const dp = st.pos.clone().add(new V(0, 1, 0)).sub(pos), dist = dp.length()
    if (dim === nd() && dist < radius) { dp.normalize().multiplyScalar((1 - dist / radius) * 22); st.vel.add(dp); st.vel.y = Math.max(st.vel.y, dp.y + 3); st.ground = false; st.hurt = Math.max(st.hurt, 0.15 * (1 - dist / radius)); if (st.inv <= 0 && st.deadT <= 0 && dist < radius * 0.35) { st.hp -= 12 * (1 - dist / radius); st.cause = "caught in a blast" } }
    sfx.play(radius > 11 ? "bigboom" : "boom", pos, Math.min(1.5, 0.8 + radius / 30))
    const sc = radius / 7
    fx.spark(pos, Math.min(300, Math.round(80 * sc)), new V(0, 1, 0), ORANGE); fx.smoke(pos, Math.min(30, Math.round(12 * sc)), new THREE.Color(0x2a2a2a), 1.8 * sc); boom.position.copy(pos); boom.intensity = 90 * Math.min(3, sc)
    const wv = new THREE.Mesh(waveGeo, waveMat.clone()); wv.position.copy(pos); wv.scale.setScalar(0.5); scene.add(wv); waves.push({ mesh: wv, t: 0, r: radius })
    st.shake = Math.max(st.shake, shake * Math.max(0, 1 - dist / (radius * 2.5)))
  }
  const blast = (b: Bomb) => {
    if (b.kind === "grenade") explode(b.pos, b.dim, 7, 20, 0.5)
    else explode(b.pos, b.dim, 13 * (1 + 0.45 * (b.n - 1)), 30 * b.n, 1.2 + 0.4 * b.n)
  }
  const throwGrenade = () => {
    if (st.gCd > 0) return
    st.gCd = 1.6 * cdm(); sfx.play("whoosh", undefined, 0.6); const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V()), m = gren()
    m.position.copy(o).addScaledVector(dir, 0.6); scene.add(m)
    bombs.push({ kind: "grenade", mesh: m, pos: m.position.clone(), vel: dir.clone().multiplyScalar(19).add(new V(0, 4, 0)).addScaledVector(st.vel, 0.4), dim: nd(), fuse: 1.7, n: 1 }); st.kick = 1.2
  }
  const TNT_MAX = 6, TNT_RECHARGE = 7 // you carry six sticks and regain one every seven seconds
  const placeTnt = () => {
    if (st.tCd > 0 || st.tnt <= 0) return
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V()); let t = 14
    for (const c of chunks.values()) for (const b of c.boxes) if (b.dim === nd()) t = Math.min(t, rayCollider(o, dir, b))
    for (let s = 1; s < t; s += 0.5) if (o.y + dir.y * s < terrainY(o.x + dir.x * s, o.z + dir.z * s)) { t = s; break }
    const p = o.clone().addScaledVector(dir, Math.max(1, t - 0.8)); p.y = Math.max(p.y, terrainY(p.x, p.z))
    const near = bombs.find(b => b.kind === "tnt" && b.dim === nd() && b.fuse > 0.5 && b.pos.distanceTo(p) < 3.2)
    st.tCd = 0.25; st.tnt--; sfx.play("clink")
    if (near) { near.n++; near.mesh.removeFromParent(); near.mesh = tntMesh(near.n); near.mesh.position.copy(near.pos); scene.add(near.mesh); fx.spark(near.pos, 14, new V(0, 1, 0), DUST); return }
    const m = tntMesh(1); m.position.copy(p); scene.add(m)
    bombs.push({ kind: "tnt", mesh: m, pos: p.clone(), vel: new V(), dim: nd(), fuse: Infinity, n: 1 })
  }
  const bombStep = (dt: number) => {
    st.gCd -= dt; st.tCd -= dt; orbTick(dt)
    if (st.tnt < TNT_MAX && (st.tntT += dt) >= TNT_RECHARGE * cdm()) { st.tnt++; st.tntT = 0 }
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i]; b.fuse -= dt
      if (b.kind === "grenade" && b.vel.lengthSq() > 0.01) {
        b.vel.y -= 22 * dt
        const len = b.vel.length() * dt, dir = b.vel.clone().normalize(); let tHit = len
        for (const c of nearChunks(2)) for (const bx of c.boxes) if (bx.dim === b.dim) tHit = Math.min(tHit, rayCollider(b.pos, dir, bx))
        if (tHit < len) { const nrm = dir.clone().negate(); b.vel.reflect(nrm.multiplyScalar(1)).multiplyScalar(0.35); b.vel.y = Math.max(b.vel.y, 0) } else b.pos.addScaledVector(dir, len)
        const gy = terrainY(b.pos.x, b.pos.z) + 0.14
        if (b.pos.y < gy) { b.pos.y = gy; b.vel.y = Math.abs(b.vel.y) * 0.35; b.vel.x *= 0.7; b.vel.z *= 0.7; if (b.vel.lengthSq() < 0.6) b.vel.set(0, 0, 0) }
        for (const c of nearChunks(2)) for (const e of c.enemies) if (e.dim === b.dim && Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) < 1.9 && b.pos.y < e.pos.y + 3) b.fuse = Math.min(b.fuse, 0.02)
      }
      b.mesh.position.copy(b.pos)
      const spark = b.mesh.getObjectByName("spark"); const pulse = 1 + 0.4 * Math.sin(time * (b.fuse === Infinity ? 6 : 14 + 30 / Math.max(0.2, b.fuse)))
      if (spark) spark.scale.setScalar(pulse); else b.mesh.scale.setScalar(1 + 0.05 * Math.sin(time * 40))
      b.mesh.visible = gap(b.dim) < 1.1
      if (b.fuse <= 0) { blast(b); b.mesh.removeFromParent(); bombs.splice(i, 1) }
    }
    for (let i = waves.length - 1; i >= 0; i--) { const w2 = waves[i]; w2.t += dt / 0.4; w2.mesh.scale.setScalar(Math.max(0.5, w2.r * Math.sqrt(w2.t))); (w2.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.max(0, 1 - w2.t); if (w2.t >= 1) { w2.mesh.removeFromParent(); waves.splice(i, 1) } }
  }
  // a walker can only shoot when no wall of its dimension lies between it and the player
  const clearShot = (e: Enemy) => {
    const from = new V(e.pos.x, e.pos.y + 2.4, e.pos.z), to = new V(st.pos.x, st.pos.y + 1.2, st.pos.z), dir = to.clone().sub(from), len = dir.length(); dir.normalize()
    for (const ch of nearChunks(2)) for (const b of ch.boxes) if (b.dim === e.dim && rayCollider(from, dir, b) < len) return false
    return true
  }
  // walkers are solid against every boulder and wall of their own dimension, however they got moved
  const rocksNear = (e: Enemy) => { const bx: Box[] = []; for (const ch of nearChunks(3)) bx.push(...ch.boxes); clearRock(bx, e.dim, e.pos, e.r) }
  const hurtPlayer = (e: Enemy, dmg: number, why: string) => {
    if (st.inv > 0 || st.deadT > 0) return
    st.cause = why; sfx.play("hurt"); st.hp -= dmg; st.hurt = 0.35; hurts.push({ x: e.pos.x - st.pos.x, z: e.pos.z - st.pos.z, t: 1 })
  }
  const enemyTick = (dt: number) => {
    const p = st.pos
    for (const c of nearChunks(2)) for (const e of [...c.enemies]) {
      if (gap(e.dim) > 1.1 && e.kind !== "boss") continue
      let dx = p.x - e.pos.x, dz = p.z - e.pos.z, dist = Math.max(0.01, Math.hypot(dx, dz))
      e.mesh.rotation.y = Math.atan2(-dx, -dz)
      let moving = false, mx = 0, mz = 0
      const live = e.dim === nd()
      if (e.kind === "walker") { moving = dist < 70 && dist > 9; if (moving) { mx = dx / dist; mz = dz / dist } }
      else if (e.kind === "swarmer") { moving = dist < 90 && dist > 1.4; if (moving) { mx = dx / dist; mz = dz / dist } }
      else if (e.kind === "flyer") {
        // close in to about 15 m then circle the player, bobbing up and down
        moving = dist < 90
        const want = 15, side = e.t2 || (e.t2 = Math.random() < 0.5 ? 1 : -1)
        mx = (dist > want + 2 ? dx / dist : dist < want - 3 ? -dx / dist : 0) + (-dz / dist) * side * 0.8; mz = (dist > want + 2 ? dz / dist : dist < want - 3 ? -dz / dist : 0) + (dx / dist) * side * 0.8
        const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l
      } else {
        // brute: lumbers, then charges; slams when in reach
        e.t1 -= dt
        const charging = e.t2 > 0; if (charging) e.t2 -= dt
        moving = dist < 80 && dist > 3.6; if (moving) { mx = dx / dist; mz = dz / dist }
        if (!charging && e.t1 <= 0 && dist < 26 && dist > 8) { e.t2 = 0.9; e.t1 = 3.2 }
        const reach = e.kind === "boss" ? 9 : 5
        if (dist < reach && e.t1 <= 0.0 && !(e.fireT > 0)) { e.fireT = 0.9; e.t1 = 1.8; sfx.play("boom", e.pos, 0.5); fx.spark(new V(e.pos.x - dx / dist * 3, e.pos.y + 0.4, e.pos.z - dz / dist * 3).setY(e.pos.y + 0.3), 30, new V(0, 1, 0), DUST) ; if (live && dist < reach + 1) { hurtPlayer(e, e.kind === "boss" ? 32 : 24, e.kind === "boss" ? "crushed by the warden" : "crushed by a brute"); st.vel.x += dx / dist * 12; st.vel.z += dz / dist * 12; st.vel.y = 7; st.ground = false } }
        e.fireT -= dt
      }
      const spd = (e.kind === "brute" || e.kind === "boss") && e.t2 > 0 ? e.speed * 3.3 : e.speed
      if (moving) { e.pos.x += mx * spd * dt; e.pos.z += mz * spd * dt }
      rocksNear(e)
      const gy = terrainY(e.pos.x, e.pos.z)
      e.pos.y = e.kind === "flyer" ? gy + e.fy + Math.sin(time * 2.2 + e.pos.x) * 0.7 : gy
      e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z)
      e.update(dt, moving, time * 5, e.kind === "brute" || e.kind === "boss" ? Math.max(0, e.fireT / 0.9) : 0)
      if (e.kind === "boss") bossTick(e, dt, dist, live)
      if (e.hitT > 0) { e.hitT -= dt; e.mesh.position.x += Math.sin(time * 90) * 0.04 * (e.hitT / 0.14) }
      if (e.kind === "swarmer" && live && dist < 1.9 && Math.abs(p.y - e.pos.y) < 2) { hurtPlayer(e, 10, "swarmed"); st.vel.x -= dx / dist * 4; st.vel.z -= dz / dist * 4; killWalker(e, false); continue }
      if ((e.kind === "walker" || e.kind === "flyer") && live && dist < 45 && (e.fireT -= dt) <= 0 && clearShot(e)) {
        e.fireT = e.kind === "flyer" ? 0.55 + Math.random() * 0.5 : 0.9 + Math.random() * 0.7
        const from = e.turret.getWorldPosition(new V()), to = new V(p.x, p.y + 1.2, p.z)
        beam(from, to, 0.03, 0.12); sfx.play("zap", from, 0.8)
        if (Math.random() < (e.kind === "flyer" ? 0.4 : 0.55)) { hurtPlayer(e, e.kind === "flyer" ? 6 : 9, e.kind === "flyer" ? "shot by a drone" : "shot by a walker"); fx.spark(to, 6, new V(0, 1, 0), ORANGE) }
      }
    }
  }
  const separate = () => {
    const live: Enemy[] = []
    for (const c of nearChunks(2)) for (const e of c.enemies) if (gap(e.dim) < 1.1) live.push(e)
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j]; if (a.dim !== b.dim) continue
      if (Math.abs(a.pos.y - b.pos.y) > 3.5) continue
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, dist = Math.hypot(dx, dz), min = (a.r + b.r) * 1.05
      if (dist >= min) continue
      const nx = dist > 0.001 ? dx / dist : 1, nz = dist > 0.001 ? dz / dist : 0, push = (min - dist) * 0.5
      a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push
    }
    for (const e of live) { rocksNear(e); e.mesh.position.x = e.pos.x; e.mesh.position.z = e.pos.z }
    for (const e of live) if (e.dim === nd()) {
      const dx = st.pos.x - e.pos.x, dz = st.pos.z - e.pos.z, dist = Math.hypot(dx, dz), min = e.hr + 0.5
      if (e.kind !== "swarmer" && dist < min && st.pos.y < e.pos.y + e.h && st.pos.y + 1.8 > e.pos.y) { const k = dist > 0.001 ? 1 / dist : 0; st.pos.x = e.pos.x + (dist > 0.001 ? dx * k : 1) * min; st.pos.z = e.pos.z + (dist > 0.001 ? dz * k : 0) * min }
    }
  }
  // stream the endless world in and out around the player, building at most a couple of pieces per frame
  // debug/recording: spawn a pack of enemies in a ring around the player
  const summon = (kind: Kind, n: number, dmin: number, dmax: number, dim = nd(), yaw0 = 0, arc = Math.PI * 2, at: THREE.Vector3 = st.pos) => {
    const out: Enemy[] = []
    for (let i = 0; i < n; i++) {
      const a = yaw0 + (arc >= Math.PI * 2 ? Math.random() * arc : (Math.random() - 0.5) * arc), rr = dmin + Math.random() * (dmax - dmin)
      const x = at.x - Math.sin(a) * rr, z = at.z - Math.cos(a) * rr, pos = new V(x, 0, z), e = makeEnemy(kind, world.foe, dim, pos)
      const bx: Box[] = []; for (const ch of nearChunks(3)) bx.push(...ch.boxes); clearRock(bx, dim, pos, e.r)
      pos.y = terrainY(pos.x, pos.z) + e.fy; e.mesh.position.copy(pos)
      const ch = chunks.get(chunkKey(Math.floor(pos.x / CH), Math.floor(pos.z / CH))); if (!ch) { continue }
      ch.group.add(e.mesh); ch.enemies.push(e); out.push(e)
    }
    return out
  }
  // ---- shrines: a multi-dimensional puzzle, then a boss, then progression ----
  // Each sector holds a shrine ringed by five pylons. Pylon i exists only in dimension i, standing on a tall boulder (climb it, wall-run it).
  // Beams of light let you spot the pylons while peeking at other dimensions. Light them in the order shown, or the shrine resets and a swarm is sent.
  // Lighting all five wakes the warden, a boss that keeps slipping between dimensions and can only be hurt in the one it is standing in.
  const SS = 300
  type Pylon = { i: number; dim: number; x: number; z: number; ty: number; top: number; placed: boolean; group: THREE.Group | null; chunk: Chunk | null; crystal: THREE.Mesh | null }
  type Shrine = { cx: number; cz: number; order: number[]; pylons: Pylon[]; lit: boolean[]; next: number; state: "idle" | "boss" | "done"; boss: Enemy | null }
  const shrines = new Map<string, Shrine>()
  const GLOWC = GLOW.map(c => new THREE.Color(c))
  const pylonMats = [...Array(N)].map((_, i) => ({
    off: track(i, new THREE.MeshBasicMaterial({ color: GLOWC[i].clone().multiplyScalar(2.2), transparent: true, toneMapped: false })) as THREE.MeshBasicMaterial,
    on: track(i, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.7).multiplyScalar(3), transparent: true, toneMapped: false })) as THREE.MeshBasicMaterial,
    beam: track(i, new THREE.MeshBasicMaterial({ color: GLOWC[i].clone().multiplyScalar(1.6), transparent: true, toneMapped: false, depthWrite: false })) as THREE.MeshBasicMaterial,
  }))
  for (const m of pylonMats) for (const x of [m.off, m.on, m.beam]) x.userData.xray = true
  const crystalGeo = new THREE.OctahedronGeometry(0.9), beamGeo2 = new THREE.CylinderGeometry(0.14, 0.14, 70, 6)
  const getShrine = (sx: number, sz: number) => {
    const key = `${sx},${sz}`; let s = shrines.get(key); if (s) return s
    let cx = (sx + 0.5) * SS + (hash(sx, sz, 1) - 0.5) * 110, cz = (sz + 0.5) * SS + (hash(sx, sz, 2) - 0.5) * 110
    const d0 = Math.hypot(cx, cz); if (d0 < 140) { cx *= 140 / Math.max(1, d0); cz *= 140 / Math.max(1, d0) }
    const order = [0, 1, 2, 3, 4]; for (let i = 4; i > 0; i--) { const j = Math.floor(hash(sx, sz, 10 + i) * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    const pylons: Pylon[] = [...Array(N)].map((_, i) => { const a = (i / N) * Math.PI * 2 + hash(sx, sz, 20 + i) * 0.8, r = 30 + hash(sx, sz, 30 + i) * 8; return { i, dim: i, x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, ty: 0, top: 0, placed: false, group: null, chunk: null, crystal: null } })
    s = { cx, cz, order, pylons, lit: [false, false, false, false, false], next: 0, state: "idle", boss: null }
    shrines.set(key, s); return s
  }
  const spotOpen = (dim: number, x: number, z: number) => {
    for (const ch of chunks.values()) {
      for (const b of ch.boxes) if (b.dim === dim && (b.ell ? Math.hypot(b.ell.cx - x, b.ell.cz - z) < Math.max(b.ell.rx, b.ell.rz) + 6 : x > b.min.x - 6 && x < b.max.x + 6 && z > b.min.z - 6 && z < b.max.z + 6)) return false
      for (const q of ch.pits) if (q.dim === dim && x > q.x0 - 6 && x < q.x1 + 6 && z > q.z0 - 6 && z < q.z1 + 6) return false
    }
    return true
  }
  const setLit = (p: Pylon, lit: boolean) => { if (p.crystal) p.crystal.material = lit ? pylonMats[p.dim].on : pylonMats[p.dim].off }
  const ensurePylon = (sh: Shrine, p: Pylon) => {
    const ch = chunks.get(chunkKey(Math.floor(p.x / CH), Math.floor(p.z / CH))); if (!ch) return
    if (p.chunk === ch && p.group?.parent) return
    if (!p.placed) {
      for (let k = 0; k < 14 && !spotOpen(p.dim, p.x, p.z); k++) { const a = Math.atan2(p.z - sh.cz, p.x - sh.cx) + (hash(p.i, k, sh.cx) - 0.5) * 0.9, r = 26 + hash(k, p.i, sh.cz) * 18; p.x = sh.cx + Math.cos(a) * r; p.z = sh.cz + Math.sin(a) * r }
      p.placed = true
    }
    const c2 = chunks.get(chunkKey(Math.floor(p.x / CH), Math.floor(p.z / CH))); if (!c2) return
    const h = 6.2, rad = 2.5, ty = terrainY(p.x, p.z), cy = ty + h * 0.45, topY = cy + h * 0.97
    const g2 = new THREE.Group(), pillar = new THREE.Mesh(BOULDERS[p.i % 4], world.rock[p.dim]); pillar.scale.set(rad, h, rad); pillar.position.set(p.x, cy, p.z); pillar.castShadow = true; pillar.receiveShadow = true; g2.add(pillar)
    const crystal = new THREE.Mesh(crystalGeo, pylonMats[p.dim].off); crystal.scale.set(0.8, 1.5, 0.8); crystal.position.set(p.x, topY + 1.9, p.z); g2.add(crystal)
    const beam = new THREE.Mesh(beamGeo2, pylonMats[p.dim].beam); beam.position.set(p.x, topY + 36, p.z); g2.add(beam)
    c2.group.add(g2); c2.boxes.push(ellBox(p.x, cy, p.z, rad * 1.12, h * 0.97, rad * 1.12, p.dim))
    p.ty = ty; p.top = topY; p.group = g2; p.chunk = c2; p.crystal = crystal; setLit(p, sh.lit[p.i])
  }
  const banner = (t: string, secs = 3) => { st.banner = t; st.bannerT = secs }
  const resetShrine = (sh: Shrine) => { sh.lit.fill(false); sh.next = 0; for (const p of sh.pylons) setLit(p, false) }
  const startBoss = (sh: Shrine) => {
    sh.state = "boss"
    const dim = (nd() + 2) % N, pos = new V(sh.cx, 0, sh.cz), e = makeEnemy("boss", world.foe, dim, pos)
    const bx: Box[] = []; for (const ch of chunks.values()) bx.push(...ch.boxes); clearRock(bx, dim, pos, e.r)
    pos.y = terrainY(pos.x, pos.z); e.mesh.position.copy(pos)
    e.maxHp = e.hp = 150 + 60 * st.level; e.shiftT = 6.5; e.fireT = 1.2
    const ch = chunks.get(chunkKey(Math.floor(pos.x / CH), Math.floor(pos.z / CH))); if (!ch) { sh.state = "idle"; resetShrine(sh); return }
    ch.group.add(e.mesh); ch.enemies.push(e); sh.boss = e
    sfx.play("bigboom", pos, 1.2); fx.spark(pos.clone().setY(pos.y + 2), 200, new V(0, 1, 0), new THREE.Color(0xffd070)); st.shake = 1.4
    banner("the warden wakes: it hides in other dimensions. hit it where it stands", 4)
  }
  const shiftBoss = (e: Enemy) => {
    const old = e.mesh, parent = old.parent; old.removeFromParent()
    let nd2 = Math.floor(Math.random() * (N - 1)); if (nd2 >= e.dim) nd2++
    const nb = makeEnemy("boss", world.foe, nd2, e.pos)
    e.mesh = nb.mesh; e.update = nb.update; e.turret = nb.turret; e.dim = nd2; e.mesh.position.copy(e.pos); parent?.add(e.mesh)
    fx.smoke(e.pos.clone().setY(e.pos.y + 2.5), 8, new THREE.Color(0x303040), 3); fx.spark(e.pos.clone().setY(e.pos.y + 3), 70, new V(0, 1, 0), GLOWC[nd2])
    sfx.play("phase", e.pos, 1)
    summon("swarmer", 4, 6, 11, nd2, 0, Math.PI * 2, e.pos)
    e.shiftT = Math.max(4, 7 - 0.4 * st.level)
  }
  const bossTick = (e: Enemy, dt: number, dist: number, live: boolean) => {
    e.shiftT = (e.shiftT ?? 6) - dt
    if (e.shiftT < 1.3 && Math.random() < 0.7) fx.spark(new V(e.pos.x + (Math.random() - 0.5) * 5, e.pos.y + 1 + Math.random() * 6, e.pos.z + (Math.random() - 0.5) * 5), 2, new V(0, 1, 0), GLOWC[e.dim])
    if (e.shiftT <= 0) shiftBoss(e)
    // orb volley: three shots in a spread
    e.maxHp = e.maxHp ?? e.hp
    e.t1 = e.t1
    if (live && dist < 60 && ((e.volT = (e.volT ?? 1.5) - dt) <= 0) && clearShot(e)) {
      e.volT = 1.9
      const from = e.turret.getWorldPosition(new V()), to = new V(st.pos.x, st.pos.y + 1.2, st.pos.z)
      for (let k = -1; k <= 1; k++) { const tt = to.clone(); tt.x += k * 3 * Math.cos(Math.atan2(st.pos.x - e.pos.x, st.pos.z - e.pos.z)); tt.z -= k * 3 * Math.sin(Math.atan2(st.pos.x - e.pos.x, st.pos.z - e.pos.z)); beam(from, tt, 0.07, 0.14) }
      sfx.play("zap", from, 1.2); if (Math.random() < 0.75) hurtPlayer(e, 13, "blasted by the warden")
    }
  }
  const bossDown = (e: Enemy) => {
    for (const sh of shrines.values()) if (sh.boss === e) { sh.state = "done"; sh.boss = null }
    st.level++; diff.hp = 1 + 0.25 * st.level
    const k = (st.level - 1) % 4, text = ["max health +20", "damage +20%", "move speed +8%", "cooldowns -15%"][k]
    if (k === 0) st.maxHp += 20; else if (k === 1) st.boon.dmg++; else if (k === 2) st.boon.spd++; else st.boon.cd++
    st.hp = st.maxHp; banner(`warden defeated. level ${st.level}. ${text}`, 4.5); sfx.play("ready")
  }
  const shrineTick = (dt: number) => {
    const p = st.pos, sx0 = Math.floor(p.x / SS), sz0 = Math.floor(p.z / SS)
    let best: Shrine | null = null, bd = 1e9
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const sh = getShrine(sx0 + dx, sz0 + dz); if (sh.state === "done") continue
      const dd = Math.hypot(sh.cx - p.x, sh.cz - p.z); if (dd < bd) { bd = dd; best = sh }
      if (dd < 110) {
        for (const py of sh.pylons) {
          ensurePylon(sh, py)
          if (py.group && py.crystal) { py.crystal.rotation.y += dt * 1.6; py.crystal.position.y = py.top + 1.9 + Math.sin(time * 2 + py.i) * 0.18; const hot = sh.state === "idle" && sh.order[sh.next] === py.i; py.crystal.scale.setScalar(hot ? 1 + 0.18 * Math.sin(time * 7) : 1); py.crystal.scale.y *= 1.5 }
          if (sh.state === "idle" && !sh.lit[py.i] && nd() === py.dim && st.deadT <= 0 && py.group && Math.hypot(p.x - py.x, p.z - py.z) < 3.4 && Math.abs(p.y - py.top) < 3.2) {
            if (sh.order[sh.next] === py.i) {
              sh.lit[py.i] = true; sh.next++; setLit(py, true); sfx.play("ready"); fx.spark(new V(py.x, py.top + 2, py.z), 60, new V(0, 1, 0), new THREE.Color(0xffe9a0)); st.kick = 1
              if (sh.next >= N) startBoss(sh); else banner(`pylon ${sh.next} of ${N}`, 1.4)
            } else {
              resetShrine(sh); sfx.play("hurt"); st.shake = 0.8; banner("wrong order: the shrine resets and sends a swarm", 3)
              summon("swarmer", 7, 9, 15, nd(), 0, Math.PI * 2, p)
              const ax = p.x - py.x, az = p.z - py.z, al = Math.hypot(ax, az) || 1; st.vel.set(ax / al * 16, 17, az / al * 16); st.ground = false; st.wallT = 0; st.jumps = 1; st.shake = 1
            }
          }
        }
        // the boss was left behind and its chunk unloaded: the shrine re-arms
        if (sh.state === "boss" && sh.boss && !sh.boss.mesh.parent && !dying.has(sh.boss)) { sh.state = "idle"; sh.boss = null; resetShrine(sh) }
      }
    }
    st.focus = best && bd < 130 && best.state === "idle" ? best : null; st.target = best; st.targetD = bd
    for (const sh of shrines.values()) if (sh.boss && sh.state === "boss") st.bossE = sh.boss
    if (st.bossE && !(st.bossE.mesh.parent)) st.bossE = null
    st.bannerT = Math.max(0, st.bannerT - dt)
  }
  const stream = () => {
    const [px, pz] = pc()
    const want: [number, number][] = []
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) want.push([px + dx, pz + dz])
    want.sort((a, b) => Math.hypot(a[0] - px, a[1] - pz) - Math.hypot(b[0] - px, b[1] - pz))
    for (const [cx, cz] of want) if (budget > 0 && !chunks.has(chunkKey(cx, cz))) { budget--; const t = performance.now(); chunks.set(chunkKey(cx, cz), buildChunk(scene, world, cx, cz)); genMs.push(Math.round(performance.now() - t)) }
    for (const c of chunks.values()) {
      const r = ring(c)
      if (r <= 1 && !c.detail && budget > 0) { budget--; buildDetail(world, c) }
      else if (r > 2 && c.detail) disposeDetail(c)
      if (r > 4) { disposeChunk(c); chunks.delete(chunkKey(c.cx, c.cz)) }
    }
  }

  const step = () => {
    st.inv = Math.max(0, st.inv - DT)
    if (st.deadT > 0) { st.deadT -= DT; st.vel.set(0, 0, 0); if (st.deadT <= 0) respawn(); return }
    const p = st.pos, v = st.vel, bx = nearBoxes()
    const fwd = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)), right = new V(Math.cos(st.yaw), 0, -Math.sin(st.yaw))
    const wish = new V().addScaledVector(fwd, +on("KeyW") - +on("KeyS")).addScaledVector(right, +on("KeyD") - +on("KeyA"))
    if (wish.lengthSq() > 0) wish.normalize()
    const SP = SPEED * (1 + 0.08 * st.boon.spd)
    const crouch = on("KeyC") || on("ControlLeft") || on("ShiftLeft")
    d += (target - d) * Math.min(1, 16 * DT)
    unstick(bx, st.slide ? 1 : 1.8)

    const speed = Math.hypot(v.x, v.z)
    if (!st.slide && st.ground && crouch && speed > 4) { st.slide = true; v.x *= Math.max(1, SP * 1.4 / speed); v.z *= Math.max(1, SP * 1.4 / speed) }
    if (!crouch || (st.ground && speed < 3)) st.slide = false

    if (st.ground) {
      if (st.slide) { v.x *= 1 - DT; v.z *= 1 - DT }
      else if (!(st.hopT > 0 && (st.jumpBuf > 0 || st.jump))) for (const a of ["x", "z"] as const) v[a] += Math.max(-60 * DT, Math.min(60 * DT, wish[a] * SP - v[a]))
    } else {
      v.x += wish.x * 30 * DT; v.z += wish.z * 30 * DT
      const cap = Math.max(speed, SP * 1.1), m = Math.hypot(v.x, v.z)
      if (m > cap) { v.x *= cap / m; v.z *= cap / m }
    }
    const glide = !st.ground && st.glide && v.y < 0 && st.wallT <= 0
    if (glide) { v.y = Math.max(v.y, -2); v.x += fwd.x * 12 * DT; v.z += fwd.z * 12 * DT }

    st.coyote = st.ground ? 0.1 : st.coyote - DT
    // a jump pressed slightly before landing is buffered, and jumping again right after touching down is a bunny hop: it keeps your speed and adds a little
    if (st.jump) { st.jump = false; st.jumpBuf = 0.12; st.jumpFresh = true } else st.jumpFresh = false
    st.jumpBuf -= DT; st.hopT -= DT
    if (st.jumpBuf > 0) {
      if (st.ground || st.coyote > 0) {
        if (crouch) { const dir = wish.lengthSq() ? wish : fwd; v.set(dir.x * 16, 9, dir.z * 16) }
        else {
          v.y = 8
          const sp0 = Math.hypot(v.x, v.z)
          if (st.hopT > 0 && sp0 > 3) { const gain = Math.min(SP * 1.8, sp0 + 1.1) / sp0; v.x *= gain; v.z *= gain; st.hops++ } else st.hops = 0
        }
        st.jumps = 1; st.slide = false; st.coyote = 0; st.jumpBuf = 0; sfx.play("jump")
      } else if (st.jumpFresh && st.wallT > 0) { v.addScaledVector(st.wn, 9); v.y = 9; st.wallT = 0; st.wallCD = 0.3; st.jumps = 1; st.jumpBuf = 0; sfx.play("jump2") }
      else if (st.jumpFresh && st.jumps < 2) { v.y = 7.5; st.jumps = 2; st.jumpBuf = 0; sfx.play("jump2") }
    }

    if (st.wallT > 0 && (!on("KeyW") || st.contact <= 0)) { st.wallT = 0; st.wallCD = 0.25 }
    if (st.wallT > 0 && (st.wallT -= DT) <= 0) st.wallCD = 0.6
    if (st.wallT > 0) {
      if ((st.scrapeT -= DT) <= 0) { st.scrapeT = 0.11; sfx.play("scrape") }
      // climb the rock: run up the face while forward is held, drifting along it, until contact is lost over the top
      const tan = new V(-st.wn.z, 0, st.wn.x); if (tan.dot(fwd) < 0) tan.negate()
      v.copy(tan).multiplyScalar(3.5).addScaledVector(st.wn, -4); v.y = 11
    } else v.y -= G * DT * (glide ? 0.08 : 1)
    st.wallCD -= DT

    if (st.surge > 0) { v.x = st.sdir.x * st.surgeSpd; v.z = st.sdir.z * st.surgeSpd }
    const h = st.slide ? 1 : 1.8
    const vyBefore = v.y, wasGround = st.ground
    hitN.set(0, 0, 0)
    const nx = move("x", h, bx), nz = move("z", h, bx), ny = move("y", h, bx)
    st.ground = ny > 0
    if (st.ground && !wasGround) { st.hopT = 0.14; if (vyBefore < -5) sfx.play("land", undefined, Math.min(1.3, -vyBefore / 12)) }
    if (st.ground && st.wallT <= 0) st.jumps = 0
    st.contact = nx || nz ? 0.2 : st.contact - DT
    // running into a rock face at speed latches onto it, from the ground or the air
    if (st.wallCD <= 0 && st.wallT <= 0 && (nx || nz) && on("KeyW") && Math.hypot(v.x, v.z) + Math.abs(v.y) > 0 && hitN.lengthSq() > 0) { st.wn.copy(hitN); st.wallT = 1.8; st.ground = false; sfx.play("land", undefined, 0.5) }

    st.fireT -= DT
    if (weapon === "sword") {
      if (st.surge > 0) {
        st.surge -= DT / st.surgeLen; st.spin = 1 - Math.max(0, st.surge); surgeCut()
        if (st.surge <= 0) { st.surge = 0; st.fireT = 0.9; st.vel.x = st.sdir.x * 8; st.vel.z = st.sdir.z * 8 }
      } else if (st.swing > 0) {
        const before = st.swing; st.swing -= DT / SWING
        if (before > 0.55 && st.swing <= 0.55) swingCut()
        if (st.swing <= 0) { st.swing = 0; st.fireT = 0.04 }
      } else if (st.fire && st.fireT <= 0) { const before = st.charge; st.charge = Math.min(MAXCHARGE, st.charge + DT); if (before < 0.22 && st.charge >= 0.22) sfx.play("ready") }
      else if (st.charge > 0) {
        if (st.charge < 0.22) { st.swing = 1; sfx.play("whoosh"); const f = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)); st.vel.x += f.x * 5; st.vel.z += f.z * 5 }
        else startSurge(st.charge / MAXCHARGE)
        st.charge = 0
      }
    }
    else if (weapon === "pistol") {
      if (st.reload > 0) { st.reload -= DT; if (st.reload <= 0) { st.ammo = MAG; sfx.play("clink") } }
      else if (st.ammo <= 0) startReload()
      else if (st.fire && st.fireT <= 0) { shootPistol(); st.fireT = 0.09 }
    }
    else if (st.fire && st.fireT <= 0) { if (st.draw === 0) sfx.draw.start(); st.draw = Math.min(1, st.draw + DT / 0.55); sfx.draw.set(st.draw) }
    else if (st.draw > 0) { if (st.draw > 0.2) { loose(st.draw); st.fireT = 0.4 } else sfx.draw.stop(); st.draw = 0 }
    for (let i = arrows.length - 1; i >= 0; i--) { arrowStep(arrows[i], DT); if (arrows[i].life <= 0) { arrows[i].mesh.removeFromParent(); arrows.splice(i, 1) } }
    best = Math.max(best, Math.floor(Math.hypot(p.x, p.z)))
    cpT -= DT
    if (cpT <= 0 && st.ground && st.hp > 40) { cpT = 2; const q = chunks.get(chunkKey(...pc())); if (q && !q.pits.some(z => z.dim === nd() && Math.abs(p.x - (z.x0 + z.x1) / 2) < 14 && Math.abs(p.z - (z.z0 + z.z1) / 2) < 14)) checkpoint = { pos: p.clone(), dim: nd() } }
    if (st.hp <= 0) die(st.cause || "you were killed")
    else if (p.y < terrainY(p.x, p.z) - 8.5 || p.y < -60) die("fell into the void")
    p.y = Math.min(p.y, 80)
  }

  // optional guided tutorial: each step completes when the player does the thing
  const keyT: Record<string, number> = {}
  let tut = -1, tutT = 0, tutBase = { x: 0, z: 0, nd: 0, n: 0, swaps: 0 }
  const TUT: [string, () => boolean][] = [
    ["wasd to move, mouse to look", () => Math.hypot(st.pos.x - tutBase.x, st.pos.z - tutBase.z) > 12],
    ["space to jump, space again in the air to double jump", () => st.jumps >= 1 && !st.ground],
    ["land and jump again right away: bunny hops build speed", () => st.hops >= 2],
    ["hold c while running to slide", () => st.slide],
    ["run at a boulder to wall run, space jumps off", () => st.wallT > 0],
    ["press e, q or scroll to phase into another dimension", () => tutBase.n >= 1],
    ["keep going: the five dimensions form a ring, it loops", () => tutBase.n >= 5],
    ["click to shoot. 1 pistol, 2 bow, 3 sword, g grenade or tnt", () => st.fire],
    ["enemies live in one dimension. phase out to dodge, phase back to strike", () => tutT > 6],
  ]
  const tutorial = () => { tut = 0; tutT = 0; tutBase = { x: st.pos.x, z: st.pos.z, nd: nd(), n: 0, swaps: 0 } }
  const tutTick = (dt: number) => {
    if (tut < 0) return
    tutT += dt; if (nd() !== tutBase.nd) { tutBase.nd = nd(); tutBase.n++ }
    if (TUT[tut][1]()) { tut++; tutT = 0; tutBase.x = st.pos.x; tutBase.z = st.pos.z; tutBase.n = 0; if (tut >= TUT.length) { tut = -1; banner("tutorial done", 3) } }
  }
  const frame = (w: number, h: number, dt: number) => {
    time += dt; uTime.value = time; tutTick(dt)
    const p = st.pos, speed = Math.hypot(st.vel.x, st.vel.z), right = new V(Math.cos(st.yaw), 0, -Math.sin(st.yaw))
    st.roll += ((st.wallT > 0 ? -0.14 * st.wn.dot(right) : 0) - st.roll) * Math.min(1, 10 * dt)
    st.kick = Math.max(0, st.kick - dt * 14); st.hit = Math.max(0, st.hit - dt); st.hurt = Math.max(0, st.hurt - dt); st.flash = Math.max(0, st.flash - dt)
    st.bob += dt * speed * (st.ground && !st.slide ? 1 : 0) * 0.9
    st.lookX *= Math.max(0, 1 - 10 * dt); st.lookY *= Math.max(0, 1 - 10 * dt)
    st.shake = Math.max(0, st.shake - dt * 2.2); cam.position.set(p.x + (Math.random() - 0.5) * st.shake * 0.5, p.y + (st.slide ? 0.7 : 1.6) + Math.sin(st.bob * 1.3) * 0.025 * Math.min(1, speed / 10) + (Math.random() - 0.5) * st.shake * 0.5, p.z)
    const dp = st.deadT > 0 ? 1 - st.deadT / st.deadLen : 0, dfall = dp * dp
    if (!dbg.freezeVm) cam.rotation.set(st.pitch - 0.5 * dfall, st.yaw, st.roll + 1.25 * dfall)
    if (st.wallT > 0) cam.position.addScaledVector(st.wn, 0.28)
    for (let k = 0; k < 4; k++) for (const b of nearBoxes()) if (b.ell) { // keep the lens outside every boulder, whose mesh bulges past its collider
      const e = b.ell, dx = cam.position.x - e.cx, dy = cam.position.y - e.cy, dz = cam.position.z - e.cz, q = Math.hypot(dx / (e.rx + 0.5), dy / (e.hh + 0.5), dz / (e.rz + 0.5))
      if (q < 1 && q > 0) cam.position.set(e.cx + dx / q, e.cy + dy / q, e.cz + dz / q)
    }
    vmCam.fov = cam.fov; vmCam.aspect = cam.aspect; vmCam.rotation.z = cam.rotation.z; vmCam.updateProjectionMatrix()
    if (dp > 0) cam.position.y -= 1.15 * dfall
    cam.fov += (80 - (weapon === "bow" ? st.draw : 0) * 14 - (weapon === "sword" ? st.charge * 6 : 0) + (st.surge > 0 ? 8 : 0) + Math.min(speed, 20) * 0.9 - cam.fov) * Math.min(1, 6 * dt); cam.updateProjectionMatrix()
    if (!dbg.freezeVm) {
      const sway = st.lookX * 0.4, lift = st.lookY * 0.4, bobY = Math.abs(Math.sin(st.bob * 1.3)) * 0.006 - (st.slide ? 0.03 : 0)
      if (weapon === "sword") {
        // upright guard; a chop raises the blade back over the shoulder then brings it down in front; a charge pulls it back and shakes
        const t = 1 - st.swing, sm = (u: number) => u * u * (3 - 2 * u), eo = (u: number) => 1 - (1 - u) * (1 - u), cp = Math.min(1, st.charge / 0.22), cf = Math.max(0, (st.charge - 0.22) / 0.78)
        let pitch = -0.28, yaw = 0, roll = 0, px = 0, py = 0, pz = 0
        if (st.surge > 0) {
          const s = st.spin; pitch = -1.55; yaw = -s * Math.PI * 2; roll = 0.1; px = -0.05; pz = -0.1
        } else if (st.swing > 0) {
          if (t < 0.28) { const u = eo(t / 0.28); pitch = -0.28 + 1.05 * u; py = 0.06 * u; pz = 0.1 * u }
          else if (t < 0.55) { const u = sm((t - 0.28) / 0.27); pitch = 0.77 - 2.5 * u; py = 0.06 - 0.16 * u; pz = 0.1 - 0.25 * u }
          else { const u = eo((t - 0.55) / 0.45); pitch = -1.73 + 1.45 * u; py = -0.1 * (1 - u); pz = -0.15 * (1 - u) }
        } else if (st.charge > 0) {
          pitch = -0.28 + 1.2 * cp + 0.35 * cf; yaw = 0.35 * cp; roll = -0.25 * cp; px = 0.08 * cp; pz = 0.18 * cp + 0.06 * cf
          px += Math.sin(time * 70) * 0.006 * cf; py += Math.cos(time * 63) * 0.006 * cf
        }
        swordPivot.position.set(0.24 + sway + px, -0.34 + bobY + py, -0.5 + pz)
        swordPivot.rotation.set(pitch + st.lookY * 0.8, yaw - st.lookX * 0.8, roll + (st.slide ? -0.12 : 0), "YXZ")
        sword.root.position.set(0, 0.1, 0); sword.root.rotation.set(0, 0, 0)
        // the spinning blade sweeps through every angle to the sun, so take the sky reflection off it for the whole dash
        for (const m of sword.shiny) m.envMapIntensity += ((st.surge > 0 ? 0.02 : m === sword.shiny[2] ? 0.5 : 0.35) - m.envMapIntensity) * Math.min(1, dt * 20)
      } else if (weapon === "bow") {
        bow.root.position.set(0.15 + sway + Math.cos(st.bob * 0.65) * 0.006, -0.2 + lift + bobY, -0.7 + st.kick * 0.03 + st.draw * 0.05)
        bow.root.rotation.set(st.kick * 0.05 + st.lookY * 0.8 + 0.03, 0.3 - st.lookX * 0.8, st.slide ? -0.12 : 0)
      } else {
        pistol.root.position.set(0.37 + sway + Math.cos(st.bob * 0.65) * 0.006, -0.3 + lift + bobY, -0.56 + st.kick * 0.03)
        pistol.root.rotation.set(st.kick * 0.05 + st.lookY * 0.8 + 0.06, 0.2 - st.lookX * 0.8, st.slide ? -0.12 : 0)
        // reload: the gun tips toward the player, the magazine drops out and a new one slides in
        const rp = st.reload > 0 ? 1 - st.reload / RELOAD : 0, dip = Math.sin(Math.min(1, rp) * Math.PI), magY = rp < 0.3 ? -rp / 0.3 : rp < 0.6 ? -1 : -(1 - (rp - 0.6) / 0.3)
        pistol.root.position.y -= dip * 0.1; pistol.root.rotation.z += dip * 0.7; pistol.root.rotation.x += dip * 0.5
        pistol.mag.position.y = -0.108 + Math.min(0, Math.max(-1, magY)) * 0.2; pistol.mag.visible = !(rp > 0.3 && rp < 0.6)
      }
    }
    bow.setDraw(st.draw, st.fireT <= 0 || st.draw > 0)
    pistol.flash.material.opacity = st.flash > 0 ? 0.65 : 0; pistol.light.intensity = st.flash > 0 ? 1.2 : 0
    sun.position.set(p.x + SUN.x * 90, p.y + SUN.y * 90, p.z + SUN.z * 90); sun.target.position.copy(p)
    uPlayer.value.copy(p); sky.position.copy(cam.position); skyTime.value = time
    sfx.listener(cam.position, cam.getWorldDirection(new V()))
    if (st.ground && !st.slide && st.wallT <= 0) { st.stepD += speed * dt; if (st.stepD > 2.6) { st.stepD = 0; sfx.play("step", undefined, Math.min(1, speed / 10)) } }
    if (nd() !== lastNd) { lastNd = nd(); sfx.play("phase") }
    if (st.slide && st.ground && (st.scrapeT -= dt) <= 0) { st.scrapeT = 0.09; sfx.play("whoosh", undefined, 0.25) }
    // walkers cost ~100 draw calls each, so only the ones that are close and in a visible dimension are drawn
    for (const c of chunks.values()) for (const e of c.enemies) e.mesh.visible = gap(e.dim) < 1.1 && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < (e.kind === "boss" ? 150 : 60)
    for (const c of chunks.values()) {
      const r = ring(c)
      if (c.detail) c.detail.visible = r <= 1
      c.lods.hi.forEach(o => (o.visible = r <= 1)); c.lods.lo.forEach(o => (o.visible = r > 1))
    }
    // the dimension you are sliding toward shows as a faint ghost, and its enemies glow through walls so you can scout them
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, 1 - gap(i) * 1.15), solid = i === nd()
      for (const m of registry[i]) {
        m.visible = a > 0; m.transparent = !solid || !!m.userData.alpha; m.depthWrite = solid && !m.userData.alpha
        const xray = !solid && m.userData.xray
        m.opacity = solid ? 1 : xray ? Math.min(1, a * 1.4) * 0.9 : a * 0.3
        m.depthTest = !xray
        const sm = m as THREE.MeshStandardMaterial
        if (sm.emissive) { if (xray) sm.emissive.set(GLOW[i]); else sm.emissive.set(0); sm.emissiveIntensity = xray ? 1.4 : 0 }
      }
    }
    for (let i = beams.length - 1; i >= 0; i--) if ((beams[i].life -= dt) <= 0) { beams[i].mesh.removeFromParent(); beams.splice(i, 1) }
    boom.intensity = Math.max(0, boom.intensity - dt * 300)
    fx.update(dt, cam.position)
    calm += ((st.surge > 0 ? 1 : 0) - calm) * Math.min(1, dt * 14); post.update(SUN, wrap(d), time, calm); post.composer.render()

    ctx.clearRect(0, 0, w, h)
    {
      const alive = st.deadT <= 0
      pistol.root.visible = alive && weapon === "pistol"; bow.root.visible = alive && weapon === "bow"; swordPivot.visible = alive && weapon === "sword"
      ctx.textAlign = "center"
      if (!alive) {
        // death: the view tips over and the screen drains to dark red, with what killed you
        const k = Math.min(1, dp * 1.6), fade = Math.max(0, (dp - 0.55) / 0.45)
        const gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, h * 0.9); gr.addColorStop(0, `rgba(60,0,0,${0.35 * k})`); gr.addColorStop(1, `rgba(120,0,0,${0.85 * k})`)
        ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); ctx.fillStyle = `rgba(0,0,0,${0.9 * fade})`; ctx.fillRect(0, 0, w, h)
        ctx.shadowColor = "#000"; ctx.shadowBlur = 12; ctx.fillStyle = `rgba(255,255,255,${Math.min(1, dp * 3)})`; ctx.font = "700 72px ui-sans-serif, system-ui, sans-serif"; ctx.fillText("you died", w / 2, h / 2 - 8)
        ctx.font = "20px ui-monospace, monospace"; ctx.fillStyle = `rgba(255,190,170,${Math.min(1, dp * 3)})`; ctx.fillText(st.cause, w / 2, h / 2 + 30)
        ctx.fillStyle = `rgba(255,255,255,${0.6 * fade})`; ctx.fillText("respawning at your last checkpoint", w / 2, h / 2 + 62)
      }
      if (st.respawnFx > 0) {
        st.respawnFx = Math.max(0, st.respawnFx - dt); const r = st.respawnFx / 1.4
        ctx.fillStyle = `rgba(210,240,255,${0.85 * r * r})`; ctx.fillRect(0, 0, w, h)
        ctx.shadowColor = "#000"; ctx.shadowBlur = 8; ctx.font = "700 44px ui-sans-serif, system-ui, sans-serif"; ctx.fillStyle = `rgba(255,255,255,${Math.min(1, r * 2)})`; ctx.fillText("respawned", w / 2, h / 2 - 40)
      }
      if (st.inv > 0 && alive) { const a = 0.18 + 0.1 * Math.sin(time * 14), gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.5, w / 2, h / 2, h * 0.95); gr.addColorStop(0, "rgba(120,200,255,0)"); gr.addColorStop(1, `rgba(120,200,255,${a})`); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h) }
      ctx.textAlign = "left"; ctx.shadowBlur = 3
    }
    for (let i = hurts.length - 1; i >= 0; i--) {
      const hh = hurts[i]; hh.t -= dt * 1.6; if (hh.t <= 0) { hurts.splice(i, 1); continue }
      // angle of the shooter relative to where the camera is facing: 0 is straight ahead, positive is to the right
      const rel = Math.atan2(-hh.x, -hh.z) - st.yaw, ang = Math.atan2(Math.sin(-rel), Math.cos(-rel)), cxs = w / 2 + Math.sin(ang) * w * 0.62, cys = h / 2 - Math.cos(ang) * h * 0.62
      const gr = ctx.createRadialGradient(cxs, cys, 0, cxs, cys, Math.max(w, h) * 0.45)
      gr.addColorStop(0, `rgba(210,20,10,${0.75 * hh.t})`); gr.addColorStop(1, "rgba(210,20,10,0)")
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h)
    }
    ctx.strokeStyle = st.hit > 0 ? "#fff" : "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.5; ctx.shadowColor = "#000"; ctx.shadowBlur = 3
    ctx.beginPath(); ctx.moveTo(w / 2 - 9, h / 2); ctx.lineTo(w / 2 - 4, h / 2); ctx.moveTo(w / 2 + 4, h / 2); ctx.lineTo(w / 2 + 9, h / 2)
    ctx.moveTo(w / 2, h / 2 - 9); ctx.lineTo(w / 2, h / 2 - 4); ctx.moveTo(w / 2, h / 2 + 4); ctx.lineTo(w / 2, h / 2 + 9); ctx.stroke()
    if (!dbg.hideHud && weapon === "pistol") { ctx.fillStyle = st.ammo <= 3 || st.reload > 0 ? "#e8c36a" : "#fff"; ctx.font = "700 22px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.fillText(st.reload > 0 ? "reloading" : `${st.ammo} / ${MAG}`, w - 30, h - 30); ctx.textAlign = "left" }
    if (!dbg.hideHud && weapon !== "sword") { const cd = weapon === "pistol" ? st.gCd : st.tnt < TNT_MAX ? TNT_RECHARGE * cdm() - st.tntT : 0, tn = bombs.filter(b => b.kind === "tnt").reduce((a, b) => a + b.n, 0); ctx.fillStyle = (weapon === "pistol" ? cd > 0 : st.tnt === 0) ? "rgba(255,255,255,0.45)" : "#e8c36a"; ctx.font = "14px ui-monospace, monospace"; ctx.fillText(weapon === "pistol" ? `G grenade${cd > 0 ? ` ${cd.toFixed(1)}s` : " ready"}` : `G tnt ${st.tnt}/${TNT_MAX}${tn ? `  planted ${tn}` : ""}${st.tnt < TNT_MAX ? `  next ${cd.toFixed(0)}s` : ""}`, 20, h - 56) }
    if (weapon === "sword" && st.charge > 0.22) { const f = (st.charge - 0.22) / 0.78; ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(w / 2 - 40, h / 2 + 34, 80, 3); ctx.fillStyle = "#e8c36a"; ctx.fillRect(w / 2 - 40, h / 2 + 34, 80 * f, 3) }
    ctx.fillStyle = "#fff"; ctx.font = "14px ui-monospace, monospace"
    if (!dbg.hideHud && st.deadT <= 0) {
      ctx.textAlign = "center"; ctx.shadowColor = "#000"; ctx.shadowBlur = 6
      const hexs = (c: number) => "#" + c.toString(16).padStart(6, "0")
      if (st.bossE) {
        // boss bar: the dimension it stands in, and a warning just before it slips away
        const e = st.bossE, bw = 460, f = Math.max(0, e.hp) / (e.maxHp ?? e.hp), warn = (e.shiftT ?? 9) < 1.3
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(w / 2 - bw / 2 - 3, 52, bw + 6, 14); ctx.fillStyle = hexs(GLOW[e.dim]); ctx.fillRect(w / 2 - bw / 2, 55, bw * f, 8)
        ctx.fillStyle = "#fff"; ctx.font = "15px ui-monospace, monospace"
        ctx.fillText(`the warden   in dimension ${e.dim + 1}${warn ? "   shifting!" : ""}${e.dim === nd() ? "   you can hit it" : "   phase to its dimension"}`, w / 2, 45)
      } else if (st.focus) {
        const s2 = st.focus; ctx.fillStyle = "#fff"; ctx.font = "15px ui-monospace, monospace"; ctx.fillText("shrine: light the pylons in this order. each exists in one dimension only", w / 2, 45)
        s2.order.forEach((dm2, k) => { const x = w / 2 + (k - 2) * 40, lit = s2.lit[dm2]; ctx.beginPath(); ctx.arc(x, 72, k === s2.next ? 12 : 9, 0, 7); ctx.fillStyle = lit ? "#fff3c0" : hexs(GLOW[dm2]); if (lit || k === s2.next) ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = hexs(GLOW[dm2]); ctx.stroke(); ctx.fillStyle = lit ? "#222" : "#fff"; ctx.font = "11px ui-monospace, monospace"; ctx.fillText(String(dm2 + 1), x, 76) })
      } else if (st.target) {
        const dx = st.target.cx - p.x, dz = st.target.cz - p.z, rel = Math.atan2(dx, -dz) - (-st.yaw) , ang = Math.atan2(Math.sin(rel), Math.cos(rel))
        ctx.save(); ctx.translate(w / 2, 62); ctx.rotate(ang); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 8); ctx.lineTo(0, 3); ctx.lineTo(-9, 8); ctx.closePath(); ctx.fill(); ctx.restore()
        ctx.fillStyle = "#fff"; ctx.font = "14px ui-monospace, monospace"; ctx.fillText(`next shrine ${Math.round(st.targetD)} m`, w / 2, 92)
      }
      if (st.bannerT > 0) { ctx.globalAlpha = Math.min(1, st.bannerT); ctx.font = "700 30px ui-sans-serif, system-ui, sans-serif"; ctx.fillStyle = "#fff"; ctx.shadowBlur = 10; ctx.fillText(st.banner, w / 2, h * 0.26); ctx.globalAlpha = 1 }
      ctx.textAlign = "left"; ctx.shadowBlur = 3
    }
    ctx.font = "14px ui-monospace, monospace"
    if (!dbg.hideHud && !dbg.hideStats) ctx.fillText(`level ${st.level}   ${Math.round(Math.hypot(p.x, p.z))} m from start   ${st.kills} kills   ${st.items} powerups   ${st.deaths} deaths   ${Math.round(speed * 3.6)} km/h`, 20, 30)
    if (!dbg.hideHud || dbg.hideStats) { ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(20, h - 30, 160, 4); ctx.fillStyle = "#e8c36a"; ctx.fillRect(20, h - 30, Math.max(0, st.hp) / st.maxHp * 160, 4) }
    // a small tick ruler on the right edge shows the dimension; the larger ring is only drawn for recordings, where it shows the loop
    if (!dbg.showKeys) { for (let i = 0; i < N; i++) { ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(w - 24, h / 2 - 120 + i * 60, 8, 1) } ctx.fillStyle = "#fff"; ctx.fillRect(w - 28, h / 2 - 120 + wrap(d) * 60, 16, 2) }
    else {
    const cx = w - 90, cy = h / 2, rr = 52, ang = (i: number) => (i / N) * Math.PI * 2 - Math.PI / 2
    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke()
    for (let i = 0; i < N; i++) { ctx.fillStyle = i === nd() ? "#fff" : "rgba(255,255,255,0.45)"; ctx.fillRect(cx + Math.cos(ang(i)) * rr - 6, cy + Math.sin(ang(i)) * rr - 6, 12, 12) }
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx + Math.cos(ang(wrap(d))) * rr, cy + Math.sin(ang(wrap(d))) * rr, 6, 0, Math.PI * 2); ctx.fill()
    ctx.textAlign = "center"; ctx.font = "22px ui-monospace, monospace"; ctx.fillText(`${nd() + 1}`, cx, cy + 8); ctx.textAlign = "left"
    }
    if (dbg.showKeys || tut >= 0) {
      const now = performance.now(), lit = (c: string) => keys.has(c) || now - (keyT[c] ?? -1e9) < 260, caps: [string, string, number][] = [["KeyQ", "q", 44], ["KeyE", "e", 44], ["", "", 20], ["KeyW", "w", 44], ["KeyA", "a", 44], ["KeyS", "s", 44], ["KeyD", "d", 44], ["", "", 20], ["Space", "space", 96], ["KeyC", "c", 44], ["", "", 20], ["Wheel", "scroll", 84]]
      let x = w / 2 - caps.reduce((a, c) => a + c[2] + 6, 0) / 2, y = h - 72; ctx.textAlign = "center"; ctx.font = "17px ui-monospace, monospace"
      for (const [c, label, cw] of caps) { if (c) { const on = c === "Wheel" ? now - lastWheel < 260 : lit(c); ctx.fillStyle = on ? "#fff" : "rgba(0,0,0,0.45)"; ctx.fillRect(x, y, cw, 44); ctx.fillStyle = on ? "#111" : "rgba(255,255,255,0.85)"; ctx.fillText(label, x + cw / 2, y + 28) } x += cw + 6 }
      ctx.textAlign = "left"
    }
    if (tut >= 0 && tut < TUT.length) { ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "13px ui-monospace, monospace"; ctx.fillText(`tutorial ${tut + 1}/${TUT.length}   t skips`, w / 2, h - 96); ctx.fillStyle = "#fff"; ctx.font = "700 22px ui-sans-serif, system-ui, sans-serif"; ctx.shadowBlur = 8; ctx.fillText(TUT[tut][0], w / 2, h - 124); ctx.shadowBlur = 3; ctx.textAlign = "left" }
  }

  let raf = 0, last = performance.now(), acc = 0
  let calm = 0, lastNd = 2
  let manual = false, scale = 1, ema = 1 / 60, frames = 0, lastWheel = 0
  const tick = (dt: number) => {
    acc += dt
    const dpr = Math.min(2, devicePixelRatio), w = canvas.clientWidth, h = canvas.clientHeight, rp = dpr * scale
    if (canvas.width !== Math.round(w * rp) || canvas.height !== Math.round(h * rp)) {
      renderer.setPixelRatio(rp); renderer.setSize(w, h, false); hud.width = w * dpr; hud.height = h * dpr
      cam.aspect = w / h; cam.updateProjectionMatrix(); post.resize(w, h, rp)
    }
    renderer.shadowMap.needsUpdate = frames++ % 3 === 0
    budget = 2
    // a short flick of the wheel only peeks at the next dimension and springs back; a longer one commits
    if (!manual && performance.now() - lastWheel > 450) target = Math.round(target)
    while (acc > DT) { acc -= DT; step() }
    enemyTick(Math.min(dt, 0.05)); separate(); bombStep(Math.min(dt, 0.05)); shrineTick(Math.min(dt, 0.05)); stream()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); frame(w, h, dt)
  }
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now
    if (!manual) {
      // dynamic resolution: trade pixels for frame rate so weak GPUs still hold a playable rate
      ema = ema * 0.92 + dt * 0.08
      if (dbg.lockScale) scale = dbg.lockScale
      else if (frames % 20 === 0) scale = Math.max(0.7, Math.min(1, scale + (ema > 1 / 45 ? -0.1 : ema < 1 / 58 ? 0.05 : 0)))
      tick(dt)
    }
  }
  status(0.85, "growing the first chunks"); await new Promise(r => setTimeout(r, 30))
  for (budget = 99, stream(); ; ) { budget = 99; stream(); if ([...chunks.values()].filter(c => ring(c) <= 1 && !c.detail).length === 0 && chunks.size >= 25) break }
  raf = requestAnimationFrame(loop)
  ;(window as unknown as { __g: unknown }).__g = { st, chunks, genMs, groundH, keys, vm: bow, pistol, sword, bombs, explode, makeSfx, sfx, summon, shrines, getShrine, killWalker, startBoss,  getNd: () => nd(), getWeapon: () => weapon, sword2: sword, sunDir: SUN, hurts, dbg, cam, scene, renderer, post, getScale: () => scale, tick, setDim: (v: number) => (target = v + N * Math.round((d - v) / N)), setManual: (v: boolean) => (manual = v) }

  const kd = (e: KeyboardEvent) => {
    sfx.init()
    if (e.code === "Space") e.preventDefault()
    if (e.code === "Digit1") swap("pistol"); if (e.code === "Digit2") swap("bow"); if (e.code === "Digit3") swap("sword"); if (e.code === "KeyG" && !e.repeat) { if (weapon === "pistol") throwGrenade(); else if (weapon === "bow") placeTnt() }
    if (e.code === "KeyM" && !e.repeat) sfx.toggleMute()
    if (e.code === "KeyF") swap(weapon === "pistol" ? "bow" : weapon === "bow" ? "sword" : "pistol")
    keyT[e.code] = performance.now()
    if (e.code === "KeyT") tut = -1
    if (e.code === "KeyR" && weapon === "pistol") startReload()
    if (e.code === "KeyQ") target = Math.round(target) - 1
    if (e.code === "KeyE") target = Math.round(target) + 1
    if (!e.repeat && e.code === "Space") st.jump = true
    keys.add(e.code)
  }
  const ku = (e: KeyboardEvent) => keys.delete(e.code)
  const mm = (e: MouseEvent) => {
    if (!document.pointerLockElement) return
    st.yaw -= e.movementX * 0.0022; st.pitch = Math.max(-1.5, Math.min(1.5, st.pitch - e.movementY * 0.0022))
    st.lookX = Math.max(-0.08, Math.min(0.08, st.lookX + e.movementX * 0.0004)); st.lookY = Math.max(-0.08, Math.min(0.08, st.lookY - e.movementY * 0.0004))
  }
  const md = (e: MouseEvent) => { if (e.button === 0) st.fire = true; if (e.button === 2) st.glide = true }
  const mu = (e: MouseEvent) => { if (e.button === 0) st.fire = false; if (e.button === 2) st.glide = false }
  const wh = (e: WheelEvent) => { e.preventDefault(); lastWheel = performance.now(); target += e.deltaY * 0.004 }
  const click = () => { sfx.init(); if (!document.pointerLockElement) canvas.requestPointerLock() }
  const noMenu = (e: Event) => e.preventDefault()
  addEventListener("keydown", kd); addEventListener("keyup", ku); addEventListener("mousemove", mm)
  addEventListener("mousedown", md); addEventListener("mouseup", mu); addEventListener("contextmenu", noMenu)
  addEventListener("wheel", wh, { passive: false }); canvas.addEventListener("click", click)
  status(1, "ready")
  return { tutorial, stop: () => {
    cancelAnimationFrame(raf); post.composer.dispose(); renderer.dispose()
    removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mousemove", mm)
    removeEventListener("mousedown", md); removeEventListener("mouseup", mu); removeEventListener("contextmenu", noMenu)
    removeEventListener("wheel", wh); canvas.removeEventListener("click", click)
  } }
}
