import * as THREE from "three"
import { makePost } from "./post"
import { loadPistol } from "./assets"
import { makeSky, SUN, skyTime } from "./sky"
import { flashTexture } from "./textures"
import { makeFx } from "./fx"
import { Enemy } from "./actors"
import { makeViewmodel } from "./viewmodel"
import { makePistol } from "./pistol"
import { makeSword } from "./sword"
import { N, terrainY } from "./materials"
import { gradient } from "./toon"
import { createSfx, makeSfx } from "./audio"
import { buildChunk, buildDetail, disposeChunk, disposeDetail, loadWorld, chunkKey, Box, Chunk, CH } from "./world"
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

export async function startGame(canvas: HTMLCanvasElement, hud: HTMLCanvasElement, signal: AbortSignal) {
  if (signal.aborted) return () => {}
  const ctx = hud.getContext("2d")!
  hud.width = 800; hud.height = 60; ctx.fillStyle = "#fff"; ctx.font = "20px ui-monospace, monospace"; ctx.fillText("loading assets", 20, 40)
  const [world, pistolModel] = await Promise.all([loadWorld(), loadPistol()])
  if (signal.aborted) return () => {}
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

  const post = makePost(renderer, scene, cam)

  const dbg = { freezeVm: false, hideHint: false }
  const sfx = createSfx()
  const fx = makeFx(scene), bow = makeViewmodel(world.metal), pistol = makePistol(flashTexture(), pistolModel, world.metal)
  const sword = makeSword(world.metal)
  type Weapon = "pistol" | "bow" | "sword"
  let weapon: Weapon = "pistol"
  const swordPivot = new THREE.Group(); swordPivot.position.set(0, -0.4, 0); swordPivot.add(sword.root); swordPivot.visible = false
  cam.add(bow.root, pistol.root, swordPivot); bow.root.visible = false
  const swap = (w: Weapon) => { if (w === weapon) return; sfx.draw.stop(); sfx.play("tick"); weapon = w; st.draw = 0; st.swing = 0; st.fireT = 0.25; bow.root.visible = w === "bow"; pistol.root.visible = w === "pistol"; swordPivot.visible = w === "sword" }
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb04a).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6)

  const chunks = new Map<string, Chunk>()
  const genMs: number[] = []
  let budget = 0
  const st = { pos: new V(0, terrainY(0, 0) + 0.05, 0), vel: new V(), yaw: 0, pitch: 0, ground: false, jumps: 0, slide: false, coyote: 0,
    wallT: 0, wallCD: 0, contact: 0, wn: new V(), hp: 100, kills: 0, fireT: 0, scrapeT: 0, stepD: 0, gCd: 0, tCd: 0, shake: 0, draw: 0, swing: 0, charge: 0, surge: 0, surgeLen: 1, surgeSpd: 0, surgeHit: new Set<unknown>(), spin: 0, sdir: new V(), hit: 0, hurt: 0, kick: 0, roll: 0, flash: 0, bob: 0,
    jump: false, fire: false, glide: false, lookX: 0, lookY: 0 }
  let d = 2, target = 2, best = 0, time = 0
  const keys = new Set<string>()
  const on = (c: string) => keys.has(c)
  const nd = () => Math.round(d)
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
  const R = 0.3
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
  const respawn = () => {
    st.pos.copy(checkpoint.pos).y += 0.3; st.vel.set(0, 0, 0); st.hp = 100; st.wallT = 0
    d = target = checkpoint.dim
  }

  const boom = new THREE.PointLight(0xffa040, 0, 30); scene.add(boom)
  const beams: { mesh: THREE.Mesh; life: number }[] = []
  const beam = (a: THREE.Vector3, b: THREE.Vector3, r: number, life: number) => {
    const mesh = new THREE.Mesh(beamGeo, beamMat), len = a.distanceTo(b)
    mesh.position.copy(a).lerp(b, 0.5); mesh.scale.set(r, len, r)
    mesh.quaternion.setFromUnitVectors(new V(0, 1, 0), b.clone().sub(a).normalize())
    scene.add(mesh); beams.push({ mesh, life })
  }
  const hitBox = (e: Enemy) => [new V(e.pos.x - 1.3, e.pos.y, e.pos.z - 1.3), new V(e.pos.x + 1.3, e.pos.y + 3, e.pos.z + 1.3)] as const

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
  }
  const shootPistol = () => {
    sfx.play("pistol")
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    dir.x += (Math.random() - 0.5) * 0.012; dir.y += (Math.random() - 0.5) * 0.012; dir.normalize()
    let tMin = 150, hit: Enemy | null = null
    for (const c of chunks.values()) for (const b of c.boxes) if (b.dim === nd()) tMin = Math.min(tMin, rayCollider(o, dir, b))
    for (let t = 1; t < tMin; t += 1.5) if (o.y + dir.y * t < terrainY(o.x + dir.x * t, o.z + dir.z * t)) { tMin = t; break }
    for (const c of nearChunks(2)) for (const e of c.enemies) if (e.dim === nd()) {
      const t = rayBox(o, dir, ...hitBox(e))
      if (t < tMin) { tMin = t; hit = e }
    }
    const end = o.clone().addScaledVector(dir, tMin), mz = pistol.muzzle.getWorldPosition(new V())
    if (hit) {
      st.hit = 0.12; hit.hitT = 0.14; sfx.play("hit", end); fx.spark(end, 10, dir.clone().negate(), ORANGE); fx.smoke(end, 1, DUST, 0.5)
      if (--hit.hp <= 0) {
        const c = hit.pos.clone().setY(hit.pos.y + 1.6)
        fx.spark(c, 90, new V(0, 1, 0), ORANGE); fx.smoke(c, 10, new THREE.Color(0x2a2a2a), 1.4); boom.position.copy(c); boom.intensity = weapon === "sword" ? 20 : 60; hit.mesh.removeFromParent(); st.kills++
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
    e.hp -= dmg; e.hitT = 0.2; e.pos.x += dx / dist * shove; e.pos.z += dz / dist * shove
    fx.spark(c, 12, new V(-dx / dist, 0.5, -dz / dist), ORANGE); fx.smoke(c, 1, DUST, 0.6)
    if (e.hp <= 0) killWalker(e)
  }
  const swingCut = () => {
    const p = st.pos, fwd = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)); let any = false
    for (const c of nearChunks(1)) for (const e of [...c.enemies]) {
      if (e.dim !== nd()) continue
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, dist = Math.hypot(dx, dz)
      if (dist > 6.5 || (dist > 1.8 && (dx * fwd.x + dz * fwd.z) / dist < 0.1)) continue
      any = true; cutAt(e, 6, 1.2)
    }
    if (any) { st.hit = 0.15; st.kick = 1.4; sfx.play("hit") }
  }
  // the 360 cut: every walker of this dimension within reach of the player at any moment of the surge is cut once
  const surgeCut = () => {
    let any = false
    for (const c of nearChunks(2)) for (const e of [...c.enemies]) {
      if (e.dim !== nd() || st.surgeHit.has(e)) continue
      if (Math.hypot(e.pos.x - st.pos.x, e.pos.z - st.pos.z) > 5 ) continue
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
  const killWalker = (e: Enemy) => {
    sfx.play("die", e.pos)
    const c = e.pos.clone().setY(e.pos.y + 1.6)
    fx.spark(c, 90, new V(0, 1, 0), ORANGE); fx.smoke(c, 10, new THREE.Color(0x2a2a2a), 1.4); boom.position.copy(c); boom.intensity = 60; e.mesh.removeFromParent(); st.kills++
    for (const ch of chunks.values()) ch.enemies = ch.enemies.filter(x => x !== e)
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
      const rad = 0.5 + 0.12 * Math.sqrt(bm.n), cx = bm.pos.x - p.x, cy = bm.pos.y + 0.3 - p.y, cz = bm.pos.z - p.z, proj = cx * dir.x + cy * dir.y + cz * dir.z
      if (proj < 0 || proj > Math.min(tMin, len) + rad) continue
      if (cx * cx + cy * cy + cz * cz - proj * proj < rad * rad && proj - rad < tMin) { tMin = Math.max(0, proj - rad); tntHit = bm }
    }
    const end = p.clone().addScaledVector(dir, Math.min(tMin, len))
    const gy = terrainY(end.x, end.z), onTerrain = end.y < gy
    if (tMin < len || onTerrain) {
      a.stuck = true; a.life = 5; p.copy(end); if (onTerrain) p.y = gy
      if (tntHit) { (tntHit as Bomb).fuse = 0.05; a.life = 0; return }
      if (hit) { sfx.play("hit", end); st.hit = 0.15; hit.hitT = 0.14; hit.hp -= 4 + 12 * a.power * a.power; fx.spark(end, 14, dir.clone().negate(), ORANGE); fx.smoke(end, 1, DUST, 0.5); if (hit.hp <= 0) killWalker(hit); a.life = 0 }
      else { sfx.play("thud", end, 0.7); fx.spark(end, 5, dir.clone().negate(), DUST); fx.smoke(end, 2, DUST, 0.6) }
      return
    }
    p.copy(end); a.vel.y -= 13 * dt; a.mesh.quaternion.setFromUnitVectors(new V(0, 0, -1), a.vel.clone().normalize())
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
  const tntMesh = (n: number) => {
    const m = new THREE.Group()
    for (let k = 0; k < n; k++) {
      const s = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), tntMat), band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.44), bandMat), top = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), blackMat)
      top.position.y = 0.24; s.add(box, band, top)
      const a = k * 2.4, ring = Math.min(k, 1) * 0.3; s.position.set(Math.cos(a) * ring, 0.21 + Math.floor(k / 3) * 0.4, Math.sin(a) * ring); s.rotation.y = k * 0.9; m.add(s)
    }
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), fuseMat); sp.position.y = 0.3 + Math.floor((n - 1) / 3) * 0.4; sp.name = "spark"; m.add(sp)
    return m
  }
  const explode = (pos: THREE.Vector3, dim: number, radius: number, dmg: number, shake: number) => {
    for (const c of chunks.values()) for (const e of [...c.enemies]) {
      if (e.dim !== dim || Math.abs(e.pos.x - pos.x) > radius || Math.abs(e.pos.z - pos.z) > radius) continue
      const dx = e.pos.x - pos.x, dy = e.pos.y + 1.5 - pos.y, dz = e.pos.z - pos.z, dist = Math.hypot(dx, dy, dz)
      if (dist > radius) continue
      e.hp -= dmg * (1 - 0.65 * dist / radius); e.hitT = 0.25; const k = (1 - dist / radius) * 4 / Math.max(0.5, Math.hypot(dx, dz)); e.pos.x += dx * k; e.pos.z += dz * k
      if (e.hp <= 0) killWalker(e)
    }
    for (const b of bombs) if (b.kind === "tnt" && b.fuse > 0.12 && b.dim === dim && b.pos.distanceTo(pos) < radius * 0.7 && b.pos !== pos) b.fuse = 0.1 + Math.random() * 0.15
    const dp = st.pos.clone().add(new V(0, 1, 0)).sub(pos), dist = dp.length()
    if (dim === nd() && dist < radius) { dp.normalize().multiplyScalar((1 - dist / radius) * 22); st.vel.add(dp); st.vel.y = Math.max(st.vel.y, dp.y + 3); st.ground = false; st.hurt = Math.max(st.hurt, 0.15 * (1 - dist / radius)); st.hp -= 12 * (1 - dist / radius) * (dist < radius * 0.35 ? 1 : 0) }
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
    st.gCd = 1.6; sfx.play("whoosh", undefined, 0.6); const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V()), m = gren()
    m.position.copy(o).addScaledVector(dir, 0.6); scene.add(m)
    bombs.push({ kind: "grenade", mesh: m, pos: m.position.clone(), vel: dir.clone().multiplyScalar(19).add(new V(0, 4, 0)).addScaledVector(st.vel, 0.4), dim: nd(), fuse: 1.7, n: 1 }); st.kick = 1.2
  }
  const placeTnt = () => {
    if (st.tCd > 0) return
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V()); let t = 14
    for (const c of chunks.values()) for (const b of c.boxes) if (b.dim === nd()) t = Math.min(t, rayCollider(o, dir, b))
    for (let s = 1; s < t; s += 0.5) if (o.y + dir.y * s < terrainY(o.x + dir.x * s, o.z + dir.z * s)) { t = s; break }
    const p = o.clone().addScaledVector(dir, Math.max(1, t - 0.4)); p.y = Math.max(p.y, terrainY(p.x, p.z))
    const near = bombs.find(b => b.kind === "tnt" && b.dim === nd() && b.fuse > 0.5 && b.pos.distanceTo(p) < 1.8)
    st.tCd = 0.7; sfx.play("clink")
    if (near) { near.n++; near.mesh.removeFromParent(); near.mesh = tntMesh(near.n); near.mesh.position.copy(near.pos); scene.add(near.mesh); fx.spark(near.pos, 14, new V(0, 1, 0), DUST); return }
    const m = tntMesh(1); m.position.copy(p); scene.add(m)
    bombs.push({ kind: "tnt", mesh: m, pos: p.clone(), vel: new V(), dim: nd(), fuse: Infinity, n: 1 })
  }
  const bombStep = (dt: number) => {
    st.gCd -= dt; st.tCd -= dt
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
      b.mesh.visible = Math.abs(b.dim - d) < 1.1
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
  const enemyTick = (dt: number) => {
    const p = st.pos
    for (const c of nearChunks(2)) for (const e of c.enemies) {
      if (Math.abs(e.dim - d) > 1.1) continue
      const dx = p.x - e.pos.x, dz = p.z - e.pos.z, dist = Math.hypot(dx, dz)
      e.mesh.rotation.y = Math.atan2(-dx, -dz)
      const moving = dist < 70 && dist > 9
      if (moving) {
        // walkers are blocked by every wall and stone of their own dimension, sliding along it when they hit
        const R = 1.7, blocked = (x: number, z: number) => { for (const ch of nearChunks(3)) for (const b of ch.boxes) if (b.dim === e.dim && b.max.y > e.pos.y + 1.5 && b.min.y < e.pos.y + 2 && x > b.min.x - R && x < b.max.x + R && z > b.min.z - R && z < b.max.z + R) return true; return false }
        const nx = e.pos.x + dx / dist * 2.5 * dt, nz = e.pos.z + dz / dist * 2.5 * dt
        if (!blocked(nx, e.pos.z)) e.pos.x = nx
        if (!blocked(e.pos.x, nz)) e.pos.z = nz
      }
      e.pos.y = terrainY(e.pos.x, e.pos.z)
      e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z)
      e.update(dt, moving, time * 5)
      if (e.hitT > 0) { e.hitT -= dt; e.mesh.position.x += Math.sin(time * 90) * 0.04 * (e.hitT / 0.14) }
      if (e.dim === nd() && dist < 45 && (e.fireT -= dt) <= 0 && clearShot(e)) {
        e.fireT = 0.9 + Math.random() * 0.7
        const from = e.turret.getWorldPosition(new V()), to = new V(p.x, p.y + 1.2, p.z)
        beam(from, to, 0.03, 0.12); sfx.play("zap", from, 0.8)
        if (Math.random() < 0.55) { sfx.play("hurt"); st.hp -= 9; st.hurt = 0.35; hurts.push({ x: e.pos.x - p.x, z: e.pos.z - p.z, t: 1 }); fx.spark(to, 6, new V(0, 1, 0), ORANGE) }
      }
    }
  }
  // walkers are solid: they push each other apart so they never overlap, and shove the player out of their body
  const separate = () => {
    const live: Enemy[] = []
    for (const c of nearChunks(2)) for (const e of c.enemies) if (Math.abs(e.dim - d) < 1.1) live.push(e)
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j]; if (a.dim !== b.dim) continue
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, dist = Math.hypot(dx, dz), min = 3.6
      if (dist >= min) continue
      const nx = dist > 0.001 ? dx / dist : 1, nz = dist > 0.001 ? dz / dist : 0, push = (min - dist) * 0.5
      a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push
    }
    for (const e of live) { e.mesh.position.x = e.pos.x; e.mesh.position.z = e.pos.z }
    for (const e of live) if (e.dim === nd()) {
      const dx = st.pos.x - e.pos.x, dz = st.pos.z - e.pos.z, dist = Math.hypot(dx, dz), min = 2.1
      if (dist < min && st.pos.y < e.pos.y + 2.8 && st.pos.y + 1.8 > e.pos.y) { const k = dist > 0.001 ? 1 / dist : 0; st.pos.x = e.pos.x + (dist > 0.001 ? dx * k : 1) * min; st.pos.z = e.pos.z + (dist > 0.001 ? dz * k : 0) * min }
    }
  }
  // stream the endless world in and out around the player, building at most a couple of pieces per frame
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
    const p = st.pos, v = st.vel, bx = nearBoxes()
    const fwd = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)), right = new V(Math.cos(st.yaw), 0, -Math.sin(st.yaw))
    const wish = new V().addScaledVector(fwd, +on("KeyW") - +on("KeyS")).addScaledVector(right, +on("KeyD") - +on("KeyA"))
    if (wish.lengthSq() > 0) wish.normalize()
    const crouch = on("KeyC") || on("ControlLeft") || on("ShiftLeft")
    d += (target - d) * Math.min(1, 16 * DT)
    unstick(bx, st.slide ? 1 : 1.8)

    const speed = Math.hypot(v.x, v.z)
    if (!st.slide && st.ground && crouch && speed > 4) { st.slide = true; v.x *= Math.max(1, SPEED * 1.4 / speed); v.z *= Math.max(1, SPEED * 1.4 / speed) }
    if (!crouch || (st.ground && speed < 3)) st.slide = false

    if (st.ground) {
      if (st.slide) { v.x *= 1 - DT; v.z *= 1 - DT }
      else for (const a of ["x", "z"] as const) v[a] += Math.max(-60 * DT, Math.min(60 * DT, wish[a] * SPEED - v[a]))
    } else {
      v.x += wish.x * 30 * DT; v.z += wish.z * 30 * DT
      const cap = Math.max(speed, SPEED * 1.1), m = Math.hypot(v.x, v.z)
      if (m > cap) { v.x *= cap / m; v.z *= cap / m }
    }
    const glide = !st.ground && st.glide && v.y < 0 && st.wallT <= 0
    if (glide) { v.y = Math.max(v.y, -2); v.x += fwd.x * 12 * DT; v.z += fwd.z * 12 * DT }

    st.coyote = st.ground ? 0.1 : st.coyote - DT
    if (st.jump) {
      st.jump = false
      if (st.ground || st.coyote > 0) {
        if (crouch) { const dir = wish.lengthSq() ? wish : fwd; v.set(dir.x * 16, 9, dir.z * 16) } else v.y = 8
        st.jumps = 1; st.slide = false; st.coyote = 0; sfx.play("jump")
      } else if (st.wallT > 0) { v.addScaledVector(st.wn, 9); v.y = 9; st.wallT = 0; st.wallCD = 0.3; st.jumps = 1; sfx.play("jump2") }
      else if (st.jumps < 2) { v.y = 7.5; st.jumps = 2; sfx.play("jump2") }
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
    if (st.ground && !wasGround && vyBefore < -5) sfx.play("land", undefined, Math.min(1.3, -vyBefore / 12))
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
    else if (weapon === "pistol") { if (st.fire && st.fireT <= 0) { shootPistol(); st.fireT = 0.09 } }
    else if (st.fire && st.fireT <= 0) { if (st.draw === 0) sfx.draw.start(); st.draw = Math.min(1, st.draw + DT / 0.55); sfx.draw.set(st.draw) }
    else if (st.draw > 0) { if (st.draw > 0.2) { loose(st.draw); st.fireT = 0.4 } else sfx.draw.stop(); st.draw = 0 }
    for (let i = arrows.length - 1; i >= 0; i--) { arrowStep(arrows[i], DT); if (arrows[i].life <= 0) { arrows[i].mesh.removeFromParent(); arrows.splice(i, 1) } }
    best = Math.max(best, Math.floor(Math.hypot(p.x, p.z)))
    cpT -= DT
    if (cpT <= 0 && st.ground && st.hp > 40) { cpT = 2; const q = chunks.get(chunkKey(...pc())); if (q && !q.pits.some(z => z.dim === nd() && Math.abs(p.x - (z.x0 + z.x1) / 2) < 14 && Math.abs(p.z - (z.z0 + z.z1) / 2) < 14)) checkpoint = { pos: p.clone(), dim: nd() } }
    if (st.hp <= 0 || p.y < terrainY(p.x, p.z) - 8.5 || p.y < -60) respawn()
    p.y = Math.min(p.y, 80)
  }

  const frame = (w: number, h: number, dt: number) => {
    time += dt; uTime.value = time
    const p = st.pos, speed = Math.hypot(st.vel.x, st.vel.z), right = new V(Math.cos(st.yaw), 0, -Math.sin(st.yaw))
    st.roll += ((st.wallT > 0 ? -0.14 * st.wn.dot(right) : 0) - st.roll) * Math.min(1, 10 * dt)
    st.kick = Math.max(0, st.kick - dt * 14); st.hit = Math.max(0, st.hit - dt); st.hurt = Math.max(0, st.hurt - dt); st.flash = Math.max(0, st.flash - dt)
    st.bob += dt * speed * (st.ground && !st.slide ? 1 : 0) * 0.9
    st.lookX *= Math.max(0, 1 - 10 * dt); st.lookY *= Math.max(0, 1 - 10 * dt)
    st.shake = Math.max(0, st.shake - dt * 2.2); cam.position.set(p.x + (Math.random() - 0.5) * st.shake * 0.5, p.y + (st.slide ? 0.7 : 1.6) + Math.sin(st.bob * 1.3) * 0.025 * Math.min(1, speed / 10) + (Math.random() - 0.5) * st.shake * 0.5, p.z)
    if (!dbg.freezeVm) cam.rotation.set(st.pitch, st.yaw, st.roll)
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
        pistol.root.position.set(0.15 + sway + Math.cos(st.bob * 0.65) * 0.006, -0.15 + lift + bobY, -0.55 + st.kick * 0.035)
        pistol.root.rotation.set(st.kick * 0.05 + st.lookY * 0.8 + 0.03, 0.3 - st.lookX * 0.8, st.slide ? -0.12 : 0)
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
    for (const c of chunks.values()) for (const e of c.enemies) e.mesh.visible = Math.abs(e.dim - d) < 1.1 && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 60
    for (const c of chunks.values()) {
      const r = ring(c)
      if (c.detail) c.detail.visible = r <= 1
      c.lods.hi.forEach(o => (o.visible = r <= 1)); c.lods.lo.forEach(o => (o.visible = r > 1))
    }
    // the dimension you are sliding toward shows as a faint ghost, and its enemies glow through walls so you can scout them
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, 1 - Math.abs(d - i) * 1.15), solid = i === nd()
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
    calm += ((st.surge > 0 ? 1 : 0) - calm) * Math.min(1, dt * 14); post.update(SUN, d, time, calm); post.composer.render()

    ctx.clearRect(0, 0, w, h)
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
    if (weapon !== "sword") { const cd = weapon === "pistol" ? st.gCd : st.tCd, tn = bombs.filter(b => b.kind === "tnt").reduce((a, b) => a + b.n, 0); ctx.fillStyle = cd > 0 ? "rgba(255,255,255,0.45)" : "#e8c36a"; ctx.font = "14px ui-monospace, monospace"; ctx.fillText(`G ${weapon === "pistol" ? "grenade" : "tnt"}${cd > 0 ? ` ${cd.toFixed(1)}s` : " ready"}${weapon === "bow" && tn ? `  planted ${tn}` : ""}`, 20, h - 56) }
    if (weapon === "sword" && st.charge > 0.22) { const f = (st.charge - 0.22) / 0.78; ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(w / 2 - 40, h / 2 + 34, 80, 3); ctx.fillStyle = "#e8c36a"; ctx.fillRect(w / 2 - 40, h / 2 + 34, 80 * f, 3) }
    ctx.fillStyle = "#fff"; ctx.font = "14px ui-monospace, monospace"
    ctx.fillText(`${Math.round(Math.hypot(p.x, p.z))} m from start   ${st.kills} kills   furthest ${best} m   ${Math.round(speed * 3.6)} km/h`, 20, 30)
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(20, h - 30, 160, 4)
    ctx.fillStyle = "#e8c36a"; ctx.fillRect(20, h - 30, Math.max(0, st.hp) * 1.6, 4)
    for (let i = 0; i < N; i++) { ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(w - 24, h / 2 - 120 + i * 60, 8, 1) }
    ctx.fillStyle = "#fff"; ctx.fillRect(w - 28, h / 2 - 120 + d * 60, 16, 2)
    if (!document.pointerLockElement && !manual && !dbg.hideHint) ctx.fillText("click to play. wasd move, mouse aim, click: pistol shoots, bow draws and looses, sword taps to chop or holds then releases to surge with a 360 cut. G throws a grenade (pistol) or plants stacking TNT (bow, shoot it to blow it up). 1 pistol, 2 bow, 3 sword, m mutes sound, wheel phase, space jump, c slide, c+space bullet jump, hold right click glide, wall: run into it", 20, h - 50)
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
    enemyTick(Math.min(dt, 0.05)); separate(); bombStep(Math.min(dt, 0.05)); stream()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); frame(w, h, dt)
  }
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now
    if (!manual) {
      // dynamic resolution: trade pixels for frame rate so weak GPUs still hold a playable rate
      ema = ema * 0.92 + dt * 0.08
      if (frames % 20 === 0) scale = Math.max(0.7, Math.min(1, scale + (ema > 1 / 45 ? -0.1 : ema < 1 / 58 ? 0.05 : 0)))
      tick(dt)
    }
  }
  for (budget = 99, stream(); ; ) { budget = 99; stream(); if ([...chunks.values()].filter(c => ring(c) <= 1 && !c.detail).length === 0 && chunks.size >= 25) break }
  raf = requestAnimationFrame(loop)
  ;(window as unknown as { __g: unknown }).__g = { st, chunks, genMs, groundH, keys, vm: bow, pistol, sword, bombs, explode, makeSfx, sword2: sword, sunDir: SUN, hurts, dbg, cam, scene, renderer, post, getScale: () => scale, tick, setDim: (v: number) => (target = v), setManual: (v: boolean) => (manual = v) }

  const kd = (e: KeyboardEvent) => {
    sfx.init()
    if (e.code === "Space") e.preventDefault()
    if (e.code === "Digit1") swap("pistol"); if (e.code === "Digit2") swap("bow"); if (e.code === "Digit3") swap("sword"); if (e.code === "KeyG" && !e.repeat) { if (weapon === "pistol") throwGrenade(); else if (weapon === "bow") placeTnt() }
    if (e.code === "KeyM" && !e.repeat) sfx.toggleMute()
    if (e.code === "KeyF") swap(weapon === "pistol" ? "bow" : weapon === "bow" ? "sword" : "pistol")
    if (e.code === "KeyQ") target = Math.max(0, Math.round(target) - 1)
    if (e.code === "KeyE") target = Math.min(N - 1, Math.round(target) + 1)
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
  const wh = (e: WheelEvent) => { e.preventDefault(); lastWheel = performance.now(); target = Math.min(N - 1, Math.max(0, target + e.deltaY * 0.004)) }
  const click = () => { sfx.init(); if (!document.pointerLockElement) canvas.requestPointerLock() }
  const noMenu = (e: Event) => e.preventDefault()
  addEventListener("keydown", kd); addEventListener("keyup", ku); addEventListener("mousemove", mm)
  addEventListener("mousedown", md); addEventListener("mouseup", mu); addEventListener("contextmenu", noMenu)
  addEventListener("wheel", wh, { passive: false }); canvas.addEventListener("click", click)
  return () => {
    cancelAnimationFrame(raf); post.composer.dispose(); renderer.dispose()
    removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mousemove", mm)
    removeEventListener("mousedown", md); removeEventListener("mouseup", mu); removeEventListener("contextmenu", noMenu)
    removeEventListener("wheel", wh); canvas.removeEventListener("click", click)
  }
}
