import * as THREE from "three"
import { makePost } from "./post"
import { makeSky, SUN, skyTime } from "./sky"
import { flashTexture } from "./textures"
import { makeFx } from "./fx"
import { Enemy, Kind, makeEnemy } from "./actors"
import { makeViewmodel } from "./viewmodel"
import { makePistol } from "./pistol"
import { makeSword } from "./sword"
import { N, terrainY, track, untrack } from "./materials"
import { gradient, PALETTE } from "./toon"
import { createSfx, makeSfx } from "./audio"
import { buildChunk, buildDetail, disposeChunk, disposeDetail, loadWorld, LOAD_STEPS, chunkKey, clearRock, ellBox, hash, Box, Chunk, CH } from "./world"
import { BOULDERS } from "./rocks"
import { registry, uTime, uPlayer } from "./materials"

const V = THREE.Vector3
type Axis = "x" | "y" | "z"
const DT = 1 / 120, G = 24, SPEED = 10
const ORANGE = new THREE.Color(0xff9a30), DUST = new THREE.Color(0xe8d9b0), WHITE = new THREE.Color(0xffffff)
// each dimension glows in its own grass colour, so a beacon, its dot in the hud and the world around it all match
const GLOW = PALETTE.map(p => p.g1)

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

// ray against a collider: boulders are tested against their real triangles (after a cheap padded-ellipsoid check), everything else is an axis-aligned box
const rayCollider = (o: THREE.Vector3, d: THREE.Vector3, b: Box) => {
  if (!b.ell) return rayBox(o, d, b.min, b.max)
  const e = b.ell, rx = e.rx * 1.3, rz = e.rz * 1.3, hh = e.hh * 1.3, ox = (o.x - e.cx) / rx, oy = (o.y - e.cy) / hh, oz = (o.z - e.cz) / rz, dx = d.x / rx, dy = d.y / hh, dz = d.z / rz
  const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), C = ox * ox + oy * oy + oz * oz - 1, disc = B * B - 4 * A * C
  if (disc < 0) return Infinity
  const m = e.mesh
  if (!m) { const t = (-B - Math.sqrt(disc)) / (2 * A); return t > 0 && o.y + d.y * t > e.bot ? t : C < 0 ? 0 : Infinity }
  // into the rock's own frame: translate, undo the turn, undo the scale
  const cs = Math.cos(m.ry), sn = Math.sin(m.ry), px = o.x - e.cx, py = o.y - e.cy, pz = o.z - e.cz
  const lox = (px * cs - pz * sn) / m.sx, loy = py / m.sy, loz = (px * sn + pz * cs) / m.sz, ldx = (d.x * cs - d.z * sn) / m.sx, ldy = d.y / m.sy, ldz = (d.x * sn + d.z * cs) / m.sz
  const pos = m.set.attributes.position.array as Float32Array
  let best = Infinity, crossings = 0
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2], e1x = pos[i + 3] - ax, e1y = pos[i + 4] - ay, e1z = pos[i + 5] - az, e2x = pos[i + 6] - ax, e2y = pos[i + 7] - ay, e2z = pos[i + 8] - az
    const hx = ldy * e2z - ldz * e2y, hy = ldz * e2x - ldx * e2z, hz = ldx * e2y - ldy * e2x, det = e1x * hx + e1y * hy + e1z * hz
    if (Math.abs(det) < 1e-9) continue
    const f = 1 / det, sx = lox - ax, sy = loy - ay, sz = loz - az, u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) continue
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = f * (ldx * qx + ldy * qy + ldz * qz); if (v < 0 || u + v > 1) continue
    const t = f * (e2x * qx + e2y * qy + e2z * qz); if (t > 0) { crossings++; if (t < best) best = t }
  }
  // an odd number of crossings means the ray starts inside the rock: that is a hit at once
  return crossings % 2 === 1 ? 0 : best
}

export async function startGame(canvas: HTMLCanvasElement, hud: HTMLCanvasElement, signal: AbortSignal, status: (frac: number, label: string) => void, practice = false) {
  const idle = { stop: () => {}, begin: () => {}, harder: () => {}, buy: (_: number) => {} }
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
    wallT: 0, wallCD: 0, contact: 0, wn: new V(), hp: 100, maxHp: 100, jumpBuf: 0, jumpFresh: false, hopT: 0, hops: 0, focus: null as { cx: number; cz: number; order: number[]; lit: boolean[]; next: number; pylons: { x: number; z: number; dim: number }[] } | null, target: null as { cx: number; cz: number } | null, targetD: 0, bossE: null as Enemy | null, level: 0, boon: { dmg: 0, spd: 0, cd: 0 }, banner: "", bannerT: 0, kills: 0, fireT: 0, ammo: 12, reload: 0, hold: 0, power: null as { k: string; t: number } | null, runT: 0, wins: 0, tnt: 6, tntT: 0, items: 0, deadT: 0, deadLen: 1.9, inv: 0, respawnFx: 0, deaths: 0, cause: "", scrapeT: 0, stepD: 0, gCd: 0, tCd: 0, shake: 0, draw: 0, swing: 0, charge: 0, surge: 0, surgeLen: 1, surgeSpd: 0, surgeHit: new Set<unknown>(), spin: 0, sdir: new V(), hit: 0, hurt: 0, kick: 0, roll: 0, flash: 0, bob: 0, kc: [0, 0, 0], pts: 0, sk: [0, 0, 0], wasBerserk: false,
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
    if (axis === "y" && v <= 0) { const gh = terrainY(st.pos.x, st.pos.z, nd()); if (st.pos.y < gh) { st.pos.y = gh; n = 1 } }
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
    st.inv = 2.5; st.ammo = mag(); st.reload = 0; st.respawnFx = 1.4; st.hurt = 0; hurts.length = 0; sfx.play("respawn")
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
  type Arrow = { mesh: THREE.Group; vel: THREE.Vector3; dim: number; power: number; life: number; stuck: boolean; boom?: boolean; boomed?: boolean; pen?: Set<Enemy> }
  const arrows: Arrow[] = []
  // the top quarter of a hit box is the head: it takes double damage and sparks white
  const headshot = (e: Enemy, y: number) => y > e.pos.y + e.h * 0.75
  const arrowGeo = { shaft: new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6).rotateX(Math.PI / 2).translate(0, 0, 0.45), head: new THREE.ConeGeometry(0.03, 0.14, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.02) }
  const arrowMat = { shaft: new THREE.MeshStandardMaterial({ color: 0xc9a56a, roughness: 0.6 }), head: new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.25 }) }
  const loose = (power: number) => {
    sfx.draw.stop(); sfx.play("loose", undefined, 0.5 + 0.5 * power)
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    const mesh = new THREE.Group(); mesh.add(new THREE.Mesh(arrowGeo.shaft, arrowMat.shaft), new THREE.Mesh(arrowGeo.head, arrowMat.head))
    mesh.position.copy(o).addScaledVector(dir, 0.8).add(new V(0.12, -0.12, 0).applyQuaternion(cam.quaternion)); mesh.quaternion.setFromUnitVectors(new V(0, 0, -1), dir); scene.add(mesh)
    arrows.push({ mesh, vel: dir.clone().multiplyScalar(26 + 52 * power).add(st.vel.clone().multiplyScalar(0.35)), dim: nd(), power, life: 6, stuck: false, boom: st.power?.k === "explosive arrows" })
    st.kick = 1.6
  }
  // skill tree: one path per weapon (pistol, bow, sword), two tiers each, one point per node
  const lvl = (w: Weapon) => st.sk[["pistol", "bow", "sword"].indexOf(w)]
  const berserk = () => lvl("pistol") >= 2 && st.hp <= 0.2 * st.maxHp
  const mag = () => 12 * (lvl("pistol") >= 1 ? 2 : 1) * (berserk() ? 2 : 1)
  const spent = () => st.sk[0] + st.sk[1] + st.sk[2]
  // points come from grinding: 20 giants, 50 spiders, or 100 drones and bomb guys each give one
  const KILLS: Partial<Record<Kind, [number, number]>> = { brute: [0, 20], swarmer: [1, 50], flyer: [2, 100], walker: [2, 100] }
  const emitSkills = () => window.dispatchEvent(new CustomEvent("phase-skills", { detail: { points: st.pts - spent(), levels: [...st.sk], progress: [st.kc[0] % 20, st.kc[1] % 50, st.kc[2] % 100] } }))
  const countKill = (k: Kind) => {
    const g = KILLS[k]; if (!g || practice) return
    if (++st.kc[g[0]] % g[1] === 0) { st.pts++; banner("skill point earned: pause to spend it", 3); sfx.play("ready") }
    emitSkills()
  }
  const buy = (i: number) => {
    if (st.pts - spent() <= 0 || st.sk[i] >= 2) return
    if (++st.sk[i] === 1 && i === 0) st.ammo += 12
    emitSkills()
  }
  const RELOAD = 1.2
  const startReload = () => { if (st.reload > 0 || st.ammo === mag()) return; st.reload = RELOAD; sfx.play("tick") }
  const shootPistol = () => {
    sfx.play("pistol"); if (st.power?.k !== "no reload") st.ammo--
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    dir.x += (Math.random() - 0.5) * 0.012; dir.y += (Math.random() - 0.5) * 0.012; dir.normalize()
    let tMin = 150, hit: Enemy | null = null
    for (const c of chunks.values()) for (const b of c.boxes) if (b.dim === nd()) tMin = Math.min(tMin, rayCollider(o, dir, b))
    for (let t = 1; t < tMin; t += 1.5) if (o.y + dir.y * t < terrainY(o.x + dir.x * t, o.z + dir.z * t, nd())) { tMin = t; break }
    for (const c of nearChunks(2)) for (const e of c.enemies) if (e.dim === nd()) {
      const t = rayBox(o, dir, ...hitBox(e))
      if (t < tMin) { tMin = t; hit = e }
    }
    const orb = rayOrb(o, dir, tMin, nd()); if (orb) { deflect(orb.o); tMin = orb.t; hit = null }
    const end = o.clone().addScaledVector(dir, tMin), mz = pistol.muzzle.getWorldPosition(new V()).applyMatrix4(cam.matrixWorld)
    if (hit) {
      st.hit = 0.12; hit.hitT = 0.14; sfx.play("hit", end); const head = headshot(hit, end.y); fx.spark(end, head ? 24 : 10, dir.clone().negate(), head ? WHITE : ORANGE); fx.smoke(end, 1, DUST, 0.5)
      if ((hit.hp -= dm() * (head ? 2 : 1) * (berserk() ? 2 : 1)) <= 0) {
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
  // a full charge cannot be sat on: held past these limits it fizzles and the weapon is locked out for a moment
  const SWORD_HOLD = 0.7, BOW_HOLD = 2.5, FIZZLE = 1.6
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
  // sword tier one: while a swing is in the air, anything shot from in front of you is turned back on its source
  const parrying = (src: Enemy) => lvl("sword") >= 1 && weapon === "sword" && st.swing > 0 && (src.pos.x - st.pos.x) * -Math.sin(st.yaw) + (src.pos.z - st.pos.z) * -Math.cos(st.yaw) > 0
  const parry = (src: Enemy) => {
    if (!parrying(src)) return false
    src.hp -= 12 * dm(); src.hitT = 0.14; sfx.play("clink", st.pos, 0.9); fx.spark(new V(st.pos.x - Math.sin(st.yaw) * 1.5, st.pos.y + 1.4, st.pos.z - Math.cos(st.yaw) * 1.5), 14, new V(0, 1, 0), WHITE)
    if (src.hp <= 0) killWalker(src)
    return true
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
    // a fully charged surge flies where you look, so aiming up carries the 360 cut skyward; a partial one stays level
    const full = charge >= 0.99, f = full ? cam.getWorldDirection(new V()) : new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)), dist = (full ? 24 : 5 + 16 * charge), dur = 0.26 + 0.2 * charge
    sfx.play("surge"); st.surge = 1; st.surgeLen = dur; st.surgeSpd = dist / dur; st.surgeHit.clear()
    st.sdir.copy(f); if (!full) st.vel.y = Math.max(st.vel.y, 1.5); st.charge = 0
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
    const big = { walker: [6.5, 9, 140], swarmer: [3.4, 5, 40], flyer: [5, 7, 90], brute: [10, 16, 260], boss: [16, 20, 420], guardian: [11, 15, 300] }[e.kind]
    if (e.kind === "boss") bossDown(e)
    if (e.kind === "guardian") for (const sh of shrines.values()) for (const py of sh.pylons) if (py.guard === e) { py.cleared = true; py.guard = null; banner("the guardian falls. the beacon is yours to claim", 3) }
    explode(c, e.dim, big[0], big[1], 0.7 + big[0] * 0.05, 0)
    fx.spark(c, big[2], new V(0, 1, 0), ORANGE); fx.smoke(c, Math.round(big[0] * 2), new THREE.Color(0x2a2a2a), big[0] * 0.34)
  }
  const arrowStep = (a: Arrow, dt: number) => {
    if (a.stuck) { a.life -= dt; return }
    a.life -= dt
    const p = a.mesh.position, dir = a.vel.clone().normalize(), len = a.vel.length() * dt, ch = nearChunks(3)
    let tMin = len, hit: Enemy | null = null
    for (const c of ch) for (const b of c.boxes) if (b.dim === a.dim) tMin = Math.min(tMin, rayCollider(p, dir, b))
    for (const c of ch) for (const e of c.enemies) if (e.dim === a.dim && !a.pen?.has(e)) { const t = rayBox(p, dir, ...hitBox(e)); if (t < tMin) { tMin = t; hit = e } }
    // a planted TNT pile is hit like a sphere sized to the pile; hitting it sets it off
    let tntHit: Bomb | null = null
    for (const bm of bombs) if (bm.kind === "tnt" && bm.dim === a.dim) {
      const rad = 1.0 + 0.24 * Math.sqrt(bm.n), cx = bm.pos.x - p.x, cy = bm.pos.y + 0.6 - p.y, cz = bm.pos.z - p.z, proj = cx * dir.x + cy * dir.y + cz * dir.z
      if (proj < 0 || proj > Math.min(tMin, len) + rad) continue
      if (cx * cx + cy * cy + cz * cz - proj * proj < rad * rad && proj - rad < tMin) { tMin = Math.max(0, proj - rad); tntHit = bm }
    }
    { const orb = rayOrb(p, dir, Math.min(tMin, len), a.dim); if (orb) deflect(orb.o) }
    const end = p.clone().addScaledVector(dir, Math.min(tMin, len))
    const gy = terrainY(end.x, end.z, a.dim), onTerrain = end.y < gy
    if (tMin < len || onTerrain) {
      a.stuck = true; a.life = 5; p.copy(end); if (onTerrain) p.y = gy
      if (a.boom && !a.boomed) { a.boomed = true; explode(end.clone(), a.dim, 6.5, 65, 0.6, 0) }
      if (tntHit) { (tntHit as Bomb).fuse = 0.05; a.life = 0; return }
      if (hit && lvl("bow") >= 1 && !onTerrain) { // piercing: the arrow keeps flying through whoever it hits
        (a.pen ??= new Set()).add(hit); sfx.play("hit", end); st.hit = 0.15; hit.hitT = 0.14; hit.hp -= (4 + 12 * a.power * a.power) * dm(); fx.spark(end, 14, dir.clone().negate(), ORANGE); if (hit.hp <= 0) killWalker(hit)
        if (lvl("bow") >= 2) spawnFire(end, a.dim)
        a.stuck = false; a.life = 6; return
      }
      if (lvl("bow") >= 2) { spawnFire(end, a.dim) }
      if (hit) { sfx.play("hit", end); st.hit = 0.15; hit.hitT = 0.14; const head = headshot(hit, end.y); hit.hp -= (4 + 12 * a.power * a.power) * dm() * (head ? 2 : 1); fx.spark(end, head ? 28 : 14, dir.clone().negate(), head ? WHITE : ORANGE); fx.smoke(end, 1, DUST, 0.5); if (hit.hp <= 0) killWalker(hit); a.life = 0 }
      else { sfx.play("thud", end, 0.7); fx.spark(end, 5, dir.clone().negate(), DUST); fx.smoke(end, 2, DUST, 0.6) }
      return
    }
    p.copy(end); a.vel.y -= 13 * dt; a.mesh.quaternion.setFromUnitVectors(new V(0, 0, -1), a.vel.clone().normalize())
  }

  const dm = () => 1 + 0.2 * st.boon.dmg, cdm = () => Math.pow(0.85, st.boon.cd)
  // kills heal by enemy size, and sometimes drop a powerup orb that stacks for the rest of the run
  const HEAL: Record<Kind, number> = { swarmer: 0.1, flyer: 0.1, walker: 0.2, brute: 0.5, boss: 1, guardian: 0.6 }, DROP: Record<Kind, number> = { swarmer: 0.04, flyer: 0.1, walker: 0.14, brute: 0.4, boss: 0, guardian: 1 }
  const orbs: { mesh: THREE.Mesh; pos: THREE.Vector3; dim: number; life: number; power?: boolean }[] = [], orbGeo = new THREE.OctahedronGeometry(0.3), orbMat = new THREE.MeshBasicMaterial({ color: 0xffd36a }), powerMat = new THREE.MeshBasicMaterial({ color: 0xa8f4ff, toneMapped: false })
  // brutes sometimes drop a glowing cyan orb that grants a timed power for one weapon
  const POWERS: [string, string][] = [["explosive arrows", "every arrow explodes where it lands"], ["whirlwind sword", "every sword swing is a 360 cut"], ["no reload", "the pistol never runs dry and fires twice as fast"]]
  const POWERUPS: [string, () => void][] = [["damage +10%", () => { st.boon.dmg += 0.5 }], ["move speed +4%", () => { st.boon.spd += 0.5 }], ["cooldowns -8%", () => { st.boon.cd += 0.5 }], ["max health +10", () => { st.maxHp += 10 }]]
  const onKill = (e: Enemy) => {
    countKill(e.kind)
    st.hp = Math.min(st.maxHp, st.hp + HEAL[e.kind] * st.maxHp)
    if (e.kind === "brute" && Math.random() < 0.6) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), powerMat); m.position.copy(e.pos).setY(e.pos.y + 1.4); scene.add(m); orbs.push({ mesh: m, pos: m.position, dim: e.dim, life: 60, power: true }) }
    if (Math.random() < DROP[e.kind]) { const mesh = new THREE.Mesh(orbGeo, orbMat); mesh.position.copy(e.pos).setY(e.pos.y + 1); scene.add(mesh); orbs.push({ mesh, pos: mesh.position, dim: e.dim, life: 45 }) }
  }
  const orbTick = (dt: number) => {
    if (st.power && (st.power.t -= dt) <= 0) { banner(`${st.power.k} wore off`, 1.5); st.power = null }
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i], here = o.dim === nd(); o.life -= dt; o.mesh.visible = here; o.mesh.rotation.y += dt * 2.5
      const dx = st.pos.x - o.pos.x, dy = st.pos.y + 1 - o.pos.y, dz = st.pos.z - o.pos.z, dist = Math.hypot(dx, dy, dz)
      if (here && dist < 9) o.pos.addScaledVector(new V(dx, dy, dz), Math.min(1, 7 * dt / Math.max(dist, 0.1)))
      if (here && dist < 1.6 && st.deadT <= 0 && o.power) { const [k, text] = POWERS[Math.floor(Math.random() * POWERS.length)]; st.power = { k, t: 25 }; banner(`${k}: ${text}`, 2.4); sfx.play("ready"); fx.spark(o.pos, 30, new V(0, 1, 0), new THREE.Color(0xa8f4ff)); o.life = 0 }
      else if (here && dist < 1.6 && st.deadT <= 0) { const [text, apply] = POWERUPS[Math.floor(Math.random() * POWERUPS.length)]; apply(); st.items++; banner(text, 1.6); sfx.play("ready"); fx.spark(o.pos, 20, new V(0, 1, 0), new THREE.Color(0xffd36a)); o.life = 0 }
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
      e.hp -= dmg * dm() * (1 - 0.65 * dist / radius) * (e.kind === "boss" || e.kind === "guardian" ? 0.4 : 1); // bosses shrug off most of a blast
 e.hitT = 0.25; const k = (1 - dist / radius) * 4 / Math.max(0.5, Math.hypot(dx, dz)); e.pos.x += dx * k; e.pos.z += dz * k
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
    st.gCd = 16 * cdm() * (practice ? 0.1 : 1); sfx.play("whoosh", undefined, 0.6); const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V()), m = gren()
    m.position.copy(o).addScaledVector(dir, 0.6); scene.add(m)
    bombs.push({ kind: "grenade", mesh: m, pos: m.position.clone(), vel: dir.clone().multiplyScalar(19).add(new V(0, 4, 0)).addScaledVector(st.vel, 0.4), dim: nd(), fuse: 1.7, n: 1 }); st.kick = 1.2
  }
  const TNT_MAX = 6, TNT_RECHARGE = 7 // you carry six sticks and regain one every seven seconds
  const placeTnt = () => {
    if (st.tCd > 0 || st.tnt <= 0) return
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V()); let t = 14
    for (const c of chunks.values()) for (const b of c.boxes) if (b.dim === nd()) t = Math.min(t, rayCollider(o, dir, b))
    for (let s = 1; s < t; s += 0.5) if (o.y + dir.y * s < terrainY(o.x + dir.x * s, o.z + dir.z * s, nd())) { t = s; break }
    const p = o.clone().addScaledVector(dir, Math.max(1, t - 0.8)); p.y = Math.max(p.y, terrainY(p.x, p.z, nd()))
    const near = bombs.find(b => b.kind === "tnt" && b.dim === nd() && b.fuse > 0.5 && b.pos.distanceTo(p) < 3.2)
    st.tCd = 0.25; st.tnt--; sfx.play("clink")
    if (near) { near.n++; near.mesh.removeFromParent(); near.mesh = tntMesh(near.n); near.mesh.position.copy(near.pos); scene.add(near.mesh); fx.spark(near.pos, 14, new V(0, 1, 0), DUST); return }
    const m = tntMesh(1); m.position.copy(p); scene.add(m)
    bombs.push({ kind: "tnt", mesh: m, pos: p.clone(), vel: new V(), dim: nd(), fuse: Infinity, n: 1 })
  }
  const bombStep = (dt: number) => {
    st.gCd -= dt; st.tCd -= dt; orbTick(dt); shotTick(dt); zoneTick(dt); fireTick(dt)
    if (st.tnt < TNT_MAX && (st.tntT += dt) >= TNT_RECHARGE * cdm()) { st.tnt++; st.tntT = 0 }
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i]; b.fuse -= dt
      if (b.kind === "grenade" && b.vel.lengthSq() > 0.01) {
        b.vel.y -= 22 * dt
        const len = b.vel.length() * dt, dir = b.vel.clone().normalize(); let tHit = len
        for (const c of nearChunks(2)) for (const bx of c.boxes) if (bx.dim === b.dim) tHit = Math.min(tHit, rayCollider(b.pos, dir, bx))
        if (tHit < len) { const nrm = dir.clone().negate(); b.vel.reflect(nrm.multiplyScalar(1)).multiplyScalar(0.35); b.vel.y = Math.max(b.vel.y, 0) } else b.pos.addScaledVector(dir, len)
        const gy = terrainY(b.pos.x, b.pos.z, b.dim) + 0.14
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
  const clearShot = (e: Enemy, dim = e.dim) => {
    const from = new V(e.pos.x, e.pos.y + 2.4, e.pos.z), to = new V(st.pos.x, st.pos.y + 1.2, st.pos.z), dir = to.clone().sub(from), len = dir.length(); dir.normalize()
    for (const ch of nearChunks(2)) for (const b of ch.boxes) if (b.dim === dim && rayCollider(from, dir, b) < len) return false
    return true
  }
  // can something standing at x,z in dim see the player? only boulders block the line
  const sees = (x: number, z: number, dim: number, h = 1.4) => {
    const from = new V(x, terrainY(x, z, dim) + h, z), to = new V(st.pos.x, st.pos.y + 1.2, st.pos.z), dir = to.clone().sub(from), len = dir.length(); dir.normalize()
    for (const ch of nearChunks(2)) for (const b of ch.boxes) if (b.dim === dim && rayCollider(from, dir, b) < len) return false
    return true
  }
  // walkers are solid against every boulder and wall of their own dimension, however they got moved
  const rocksNear = (e: Enemy) => { const bx: Box[] = []; for (const ch of nearChunks(3)) bx.push(...ch.boxes); clearRock(bx, e.dim, e.pos, e.r) }
  // ranged shots miss more when you are fast and high: up to half of them at full speed well off the ground
  const dodge = () => 1 - Math.min(0.5, 0.2 * Math.min(1, st.vel.length() / 16) + 0.3 * Math.min(1, Math.max(0, st.pos.y - terrainY(st.pos.x, st.pos.z, nd())) / 10))
  const hurtPlayer = (e: Enemy, dmg: number, why: string) => {
    if (practice || st.inv > 0 || st.deadT > 0) return // practice mode cannot hurt you
    dmg *= (1 + 0.4 * st.level) * (e.kind === "boss" || e.kind === "guardian" ? 1.35 : 1)
    st.cause = why; sfx.play("hurt"); st.hp -= dmg; st.hurt = 0.35; hurts.push({ x: e.pos.x - st.pos.x, z: e.pos.z - st.pos.z, t: 1 })
  }
  const enemyTick = (dt: number) => {
    const p = st.pos
    for (const c of nearChunks(2)) for (const e of [...c.enemies]) {
      if (gap(e.dim) > 1.1 && e.kind !== "boss") continue
      // enemies toughen with every beacon completed: hp is raised the first time they act after a level up
      if ((e.lv ?? 0) < st.level) { const k = (1 + 0.5 * st.level) / (1 + 0.5 * (e.lv ?? 0)); e.hp *= k; if (e.maxHp) e.maxHp *= k; e.lv = st.level }
      let dx = p.x - e.pos.x, dz = p.z - e.pos.z, dist = Math.max(0.01, Math.hypot(dx, dz))
      e.mesh.rotation.y = Math.atan2(-dx, -dz)
      let moving = false, mx = 0, mz = 0, gsp = 1
      const live = e.kind === "boss" || e.dim === nd() // the warden strikes across dimensions
      if (e.kind === "walker") { moving = dist < 70 && dist > 9; if (moving) { mx = dx / dist; mz = dz / dist } }
      else if (e.kind === "swarmer") { moving = dist < 90 && dist > 1.4; if (moving) { mx = dx / dist; mz = dz / dist } }
      else if (e.kind === "flyer") {
        // close in to about 15 m then circle the player, bobbing up and down
        moving = dist < 90
        const want = 15, side = e.t2 || (e.t2 = Math.random() < 0.5 ? 1 : -1)
        mx = (dist > want + 2 ? dx / dist : dist < want - 3 ? -dx / dist : 0) + (-dz / dist) * side * 0.8; mz = (dist > want + 2 ? dz / dist : dist < want - 3 ? -dz / dist : 0) + (dx / dist) * side * 0.8
        const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l
      } else if (e.kind === "guardian") {
        const g = guardianAI(e, dt, dx, dz, dist); moving = g.moving; mx = g.mx; mz = g.mz; gsp = g.spd
      } else {
        // brute: lumbers, then charges; slams when in reach
        e.t1 -= dt
        const charging = e.t2 > 0; if (charging) e.t2 -= dt
        moving = dist < (e.kind === "boss" ? 400 : 80) && dist > (e.kind === "boss" ? 8 : 3.6); if (moving) { mx = dx / dist; mz = dz / dist }
        if (!charging && e.t1 <= 0 && dist < 26 && dist > 8) { e.t2 = 0.9; e.t1 = 3.2 }
        const reach = e.kind === "boss" ? 9 : 5
        if (dist < reach && e.t1 <= 0.0 && !(e.fireT > 0)) { e.fireT = 0.9; e.t1 = 1.8; sfx.play("boom", e.pos, 0.5); fx.spark(new V(e.pos.x - dx / dist * 3, e.pos.y + 0.4, e.pos.z - dz / dist * 3).setY(e.pos.y + 0.3), 30, new V(0, 1, 0), DUST) ; if (live && dist < reach + 1) { hurtPlayer(e, e.kind === "boss" ? 32 : 24, e.kind === "boss" ? "crushed by the warden" : "crushed by a brute"); st.vel.x += dx / dist * 12; st.vel.z += dz / dist * 12; st.vel.y = 7; st.ground = false } }
        e.fireT -= dt
      }
      if (e.kind === "boss") { const av = tntAvoid(e); if (av) { mx = av.x; mz = av.z; moving = true; gsp = 1.8 } }
      const spd = (e.kind === "guardian" ? e.speed * gsp : e.kind === "boss" && gsp > 1 ? e.speed * gsp : (e.kind === "brute" || e.kind === "boss") && e.t2 > 0 ? e.speed * 3.3 : e.speed) * (1 + 0.08 * st.level) * (practice ? 0.25 : 1) // practice enemies crawl
      if (moving) { e.pos.x += mx * spd * dt; e.pos.z += mz * spd * dt }
      if (e.kind !== "boss") rocksNear(e) // the warden glides through rock
      const gy = terrainY(e.pos.x, e.pos.z, e.dim)
      e.pos.y = e.kind === "flyer" ? gy + e.fy + Math.sin(time * 2.2 + e.pos.x) * 0.7 : gy
      e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z)
      e.update(dt, moving, time * 5, e.kind === "brute" || e.kind === "boss" || e.kind === "guardian" ? Math.max(0, e.fireT / 0.9) : 0)
      if (e.kind === "boss") { bossTick(e, dt, dist); rehome(e) }
      if (e.hitT > 0) { e.hitT -= dt; e.mesh.position.x += Math.sin(time * 90) * 0.04 * (e.hitT / 0.14) }
      if (e.kind === "swarmer" && live && dist < 1.9 && Math.abs(p.y - e.pos.y) < 2) { hurtPlayer(e, 10, "swarmed"); st.vel.x -= dx / dist * 4; st.vel.z -= dz / dist * 4; killWalker(e, false); continue }
      if ((e.kind === "walker" || e.kind === "flyer") && live && dist < 45 && (e.fireT -= dt * (1 + 0.12 * st.level)) <= 0 && clearShot(e)) {
        e.fireT = e.kind === "flyer" ? 0.55 + Math.random() * 0.5 : 0.9 + Math.random() * 0.7
        const from = e.turret.getWorldPosition(new V()), to = new V(p.x, p.y + 1.2, p.z)
        beam(from, to, 0.03, 0.12); sfx.play("zap", from, 0.8)
        if (Math.random() < (e.kind === "flyer" ? 0.4 : 0.55) * dodge() && !parry(e)) { hurtPlayer(e, e.kind === "flyer" ? 6 : 9, e.kind === "flyer" ? "shot by a drone" : "shot by a walker"); fx.spark(to, 6, new V(0, 1, 0), ORANGE) }
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
    for (const e of live) { if (e.kind !== "boss") rocksNear(e); e.mesh.position.x = e.pos.x; e.mesh.position.z = e.pos.z }
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
      pos.y = terrainY(pos.x, pos.z, dim) + e.fy; e.mesh.position.copy(pos)
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
  type Pylon = { i: number; dim: number; x: number; z: number; ty: number; top: number; placed: boolean; group: THREE.Group | null; chunk: Chunk | null; crystal: THREE.Mesh | null; guard: Enemy | null; cleared: boolean }
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
    const pylons: Pylon[] = [...Array(N)].map((_, i) => { const a = (i / N) * Math.PI * 2 + hash(sx, sz, 20 + i) * 0.8, r = 30 + hash(sx, sz, 30 + i) * 8; return { i, dim: i, x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, ty: 0, top: 0, placed: false, group: null, chunk: null, crystal: null, guard: null, cleared: false } })
    s = { cx, cz, order, pylons, lit: [false, false, false, false, false], next: 0, state: "idle", boss: null }
    shrines.set(key, s); return s
  }
  // distance from a point to the nearest rock of a dimension
  const clearance = (dim: number, x: number, z: number) => {
    let m = 1e9
    for (const ch of chunks.values()) for (const b of ch.boxes) if (b.dim === dim) m = Math.min(m, b.ell ? Math.hypot(b.ell.cx - x, b.ell.cz - z) - Math.max(b.ell.rx, b.ell.rz) : Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z)))
    return m
  }
  const setLit = (p: Pylon, lit: boolean) => { if (p.crystal) p.crystal.material = lit ? pylonMats[p.dim].on : pylonMats[p.dim].off }
  const ensurePylon = (sh: Shrine, p: Pylon) => {
    const ch = chunks.get(chunkKey(Math.floor(p.x / CH), Math.floor(p.z / CH))); if (!ch) return
    if (p.chunk === ch && p.group?.parent) return
    if (!p.placed) {
      // wait until the ground around the shrine exists, so the search below sees every rock
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!chunks.has(chunkKey(Math.floor(sh.cx / CH) + dx, Math.floor(sh.cz / CH) + dz))) return
      // choose the loaded spot with the most open ground around it and the flattest terrain, so a pylon is never buried in rock or a hill
      let best = { x: p.x, z: p.z, score: -1e9 }
      for (let k = 0; k < 120; k++) {
        const a = hash(p.i, k, sh.cx) * Math.PI * 2, r = 24 + hash(k, p.i, sh.cz) * 40, x = sh.cx + Math.cos(a) * r, z = sh.cz + Math.sin(a) * r
        if (!chunks.has(chunkKey(Math.floor(x / CH), Math.floor(z / CH)))) continue
        const h0 = terrainY(x, z, p.dim), slope = Math.max(...[[8, 0], [-8, 0], [0, 8], [0, -8]].map(([dx, dz]) => Math.abs(terrainY(x + dx, z + dz, p.dim) - h0)))
        const score = Math.min(clearance(p.dim, x, z), 14) - slope * 3
        if (score > best.score) best = { x, z, score }
      }
      p.x = best.x; p.z = best.z; p.placed = true
    }
    const c2 = chunks.get(chunkKey(Math.floor(p.x / CH), Math.floor(p.z / CH))); if (!c2) return
    const h = 6.2, rad = 2.5, ty = terrainY(p.x, p.z, p.dim), cy = ty + h * 0.45, topY = cy + h * 0.97
    const g2 = new THREE.Group(), pillar = new THREE.Mesh(BOULDERS[p.i % 4], world.rock[p.dim]); pillar.scale.set(rad, h, rad); pillar.position.set(p.x, cy, p.z); pillar.castShadow = true; pillar.receiveShadow = true; g2.add(pillar)
    const crystal = new THREE.Mesh(crystalGeo, pylonMats[p.dim].off); crystal.scale.set(0.8, 1.5, 0.8); crystal.position.set(p.x, topY + 1.9, p.z); g2.add(crystal)
    const beam = new THREE.Mesh(beamGeo2, pylonMats[p.dim].beam); beam.position.set(p.x, topY + 36, p.z); g2.add(beam)
    c2.group.add(g2); c2.boxes.push(ellBox(p.x, cy, p.z, rad * 1.12, h * 0.97, rad * 1.12, p.dim, { sx: rad, sy: h, sz: rad, ry: 0, set: BOULDERS[p.i % 4] }))
    p.ty = ty; p.top = topY; p.group = g2; p.chunk = c2; p.crystal = crystal; setLit(p, sh.lit[p.i])
  }
  const banner = (t: string, secs = 3) => { st.banner = t; st.bannerT = secs }
  const resetShrine = (sh: Shrine) => { sh.lit.fill(false); sh.next = 0; for (const p of sh.pylons) setLit(p, false) }
  // the warden gets its own materials, flagged to stay visible as a translucent ghost in every dimension
  const ghostify = (e: Enemy) => {
    const mats: THREE.Material[] = []
    e.mesh.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const c = (m.material as THREE.Material).clone(); c.userData = { xray: true, always: true }; track(e.dim, c); m.material = c; mats.push(c) })
    e.ghost = mats
  }
  // a chasing enemy moves between chunks: keep it in the list of the chunk it stands in so hits and ticks still find it
  const rehome = (e: Enemy) => {
    const to = chunks.get(chunkKey(Math.floor(e.pos.x / CH), Math.floor(e.pos.z / CH))); if (!to || to.enemies.includes(e)) return
    for (const c of chunks.values()) c.enemies = c.enemies.filter(x => x !== e)
    to.enemies.push(e); to.group.add(e.mesh)
  }
  const startBoss = (sh: Shrine) => {
    sh.state = "boss"
    // it arrives right on top of you, 22 m ahead, rather than waiting at the shrine
    const dim = (nd() + 2) % N, ay = st.yaw + (Math.random() - 0.5) * 1.2, pos = new V(st.pos.x - Math.sin(ay) * 22, 0, st.pos.z - Math.cos(ay) * 22), e = makeEnemy("boss", world.foe, dim, pos)
    const bx: Box[] = []; for (const ch of chunks.values()) bx.push(...ch.boxes); clearRock(bx, dim, pos, e.r)
    pos.y = terrainY(pos.x, pos.z, dim); e.mesh.position.copy(pos)
    e.maxHp = e.hp = 450 + 130 * st.level; e.shiftT = 6.5; e.fireT = 1.2
    const ch = chunks.get(chunkKey(Math.floor(pos.x / CH), Math.floor(pos.z / CH))); if (!ch) { sh.state = "idle"; resetShrine(sh); return }
    ghostify(e); ch.group.add(e.mesh); ch.enemies.push(e); sh.boss = e
    sfx.play("bigboom", pos, 1.2); fx.spark(pos.clone().setY(pos.y + 2), 200, new V(0, 1, 0), new THREE.Color(0xffd070)); st.shake = 1.4
    banner("the warden hunts you across dimensions. hit it in the dimension it stands in", 4)
  }
  const shiftBoss = (e: Enemy) => {
    const old = e.mesh, parent = old.parent; old.removeFromParent(); untrack(e.dim, e.ghost ?? [])
    let nd2 = Math.floor(Math.random() * (N - 1)); if (nd2 >= e.dim) nd2++
    const nb = makeEnemy("boss", world.foe, nd2, e.pos)
    e.mesh = nb.mesh; e.update = nb.update; e.turret = nb.turret; e.dim = nd2; e.mesh.position.copy(e.pos); ghostify(e); parent?.add(e.mesh)
    fx.smoke(e.pos.clone().setY(e.pos.y + 2.5), 8, new THREE.Color(0x303040), 3); fx.spark(e.pos.clone().setY(e.pos.y + 3), 70, new V(0, 1, 0), GLOWC[nd2])
    sfx.play("phase", e.pos, 1)
    summon("swarmer", 4, 6, 11, nd2, 0, Math.PI * 2, e.pos)
    e.shiftT = Math.max(4, 7 - 0.4 * st.level)
  }
  const bossTick = (e: Enemy, dt: number, dist: number) => {
    // it never lets you lose it: once you outrun it, it phases in beside you
    e.ai = e.ai ?? {}; e.ai.blink = (e.ai.blink ?? 0) - dt
    const enr = e.hp < (e.maxHp ?? e.hp) * 0.5; if (enr && !e.ai.enraged) { e.ai.enraged = 1; banner("the warden enrages", 2); sfx.play("bigboom", e.pos, 1.3); st.shake = Math.max(st.shake, 1) }
    if (dist > 38 && e.ai.blink <= 0) {
      e.ai.blink = 4; const an = Math.random() * Math.PI * 2; fx.spark(new V(e.pos.x, e.pos.y + 3, e.pos.z), 50, new V(0, 1, 0), GLOWC[e.dim])
      e.pos.x = st.pos.x + Math.cos(an) * 16; e.pos.z = st.pos.z + Math.sin(an) * 16; e.pos.y = terrainY(e.pos.x, e.pos.z, e.dim); sfx.play("phase", e.pos, 1.2); fx.spark(new V(e.pos.x, e.pos.y + 3, e.pos.z), 50, new V(0, 1, 0), GLOWC[e.dim])
    }
    e.shiftT = (e.shiftT ?? 6) - dt
    if (e.shiftT < 1.3 && Math.random() < 0.7) fx.spark(new V(e.pos.x + (Math.random() - 0.5) * 5, e.pos.y + 1 + Math.random() * 6, e.pos.z + (Math.random() - 0.5) * 5), 2, new V(0, 1, 0), GLOWC[e.dim])
    if (e.shiftT <= 0) shiftBoss(e)
    if (enr && e.shiftT > 3.2) e.shiftT = 3.2
    // orb volley: three shots in a spread
    e.maxHp = e.maxHp ?? e.hp
    e.t1 = e.t1
    if (dist < 60 && ((e.volT = (e.volT ?? 1.5) - dt) <= 0) && clearShot(e, nd())) {
      e.volT = enr ? 1.1 : 1.9
      const from = e.turret.getWorldPosition(new V()), to = new V(st.pos.x, st.pos.y + 1.2, st.pos.z)
      for (let k = enr ? -2 : -1; k <= (enr ? 2 : 1); k++) { const tt = to.clone(); tt.x += k * 3 * Math.cos(Math.atan2(st.pos.x - e.pos.x, st.pos.z - e.pos.z)); tt.z -= k * 3 * Math.sin(Math.atan2(st.pos.x - e.pos.x, st.pos.z - e.pos.z)); beam(from, tt, 0.07, 0.14) }
      sfx.play("zap", from, 1.2); if (Math.random() < 0.75 * dodge() && !parry(e)) hurtPlayer(e, 13, "blasted by the warden")
    }
  }
  // projectiles that fly in the dimension of whoever fired them
  const shots: { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; life: number; dmg: number; dim: number; src: Enemy; ring?: boolean; back?: boolean }[] = []
  const shotGeo = new THREE.SphereGeometry(0.45, 8, 6)
  const spawnShot = (e: Enemy, from: THREE.Vector3, dir: THREE.Vector3, speed: number, dmg: number, ring = false) => {
    const mesh = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({ color: GLOWC[e.dim].clone().multiplyScalar(2), toneMapped: false })); mesh.position.copy(from); scene.add(mesh)
    shots.push({ mesh, pos: mesh.position, vel: dir.clone().normalize().multiplyScalar(speed), life: 3.2, dmg, dim: e.dim, src: e, ring })
  }
  // shooting an orb sends it back at whoever fired it
  const deflect = (o: (typeof shots)[number]) => {
    o.back = true; o.life = 3; o.vel.copy(o.src.pos).setY(o.src.pos.y + o.src.h * 0.6).sub(o.pos).normalize().multiplyScalar(34); (o.mesh.material as THREE.MeshBasicMaterial).color.set(0xffffff).multiplyScalar(2); sfx.play("clink", o.pos, 0.8)
  }
  // nearest live orb a ray passes through within maxT
  const rayOrb = (p: THREE.Vector3, dir: THREE.Vector3, maxT: number, dim: number) => {
    let best: (typeof shots)[number] | null = null, bt = maxT
    for (const o of shots) if (!o.back && o.dim === dim) { const c = o.pos.clone().sub(p), t = c.dot(dir); if (t > 0 && t < bt && c.addScaledVector(dir, -t).length() < 0.9) { bt = t; best = o } }
    return best && { o: best, t: bt }
  }
  const shotTick = (dt: number) => {
    for (let i = shots.length - 1; i >= 0; i--) {
      const o = shots[i]; o.pos.addScaledVector(o.vel, dt); o.life -= dt; o.mesh.visible = o.dim === nd()
      if (o.back) { const sp = o.src.pos; if (Math.hypot(sp.x - o.pos.x, sp.z - o.pos.z) < o.src.hr + 0.6 && o.pos.y > sp.y - 0.5 && o.pos.y < sp.y + o.src.h + 1) { o.src.hp -= 30 * dm(); o.src.hitT = 0.14; sfx.play("hit", o.pos); fx.spark(o.pos, 14, new V(0, 1, 0), WHITE); if (o.src.hp <= 0) killWalker(o.src); o.life = 0 } }
      else if (o.dim === nd()) {
        // a ring orb is a band across the body: standing is hit, a slide ducks a high one, a jump clears a low one
        const hit = o.ring ? Math.hypot(st.pos.x - o.pos.x, st.pos.z - o.pos.z) < 1.1 && o.pos.y + 0.3 > st.pos.y && o.pos.y - 0.3 < st.pos.y + (st.slide ? 0.9 : 1.8) : Math.hypot(st.pos.x - o.pos.x, st.pos.y + 1 - o.pos.y, st.pos.z - o.pos.z) < 1.5
        if (hit) { if (parrying(o.src)) deflect(o); else { hurtPlayer(o.src, o.dmg, "hit by a guardian's orb"); o.life = 0 } }
      }
      if (o.life <= 0) { o.mesh.removeFromParent(); (o.mesh.material as THREE.Material).dispose(); shots.splice(i, 1) }
    }
  }
  // bow tier two: where an arrow lands it leaves a patch of fire that burns every enemy standing in it
  const fires: { mesh: THREE.Mesh; pos: THREE.Vector3; dim: number; t: number; tick: number }[] = []
  const fireGeo = new THREE.CircleGeometry(4.5, 28).rotateX(-Math.PI / 2)
  const spawnFire = (at: THREE.Vector3, dim: number) => {
    const mesh = new THREE.Mesh(fireGeo, new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }))
    mesh.position.set(at.x, terrainY(at.x, at.z, dim) + 0.15, at.z); scene.add(mesh); fires.push({ mesh, pos: mesh.position, dim, t: 4, tick: 0 }); fx.smoke(at, 3, ORANGE, 1.2)
  }
  const fireTick = (dt: number) => {
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i]; f.t -= dt; f.mesh.visible = f.dim === nd(); (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.2 * Math.sin(time * 18) + 0.1 * Math.min(1, f.t)
      if ((f.tick -= dt) <= 0) {
        f.tick = 0.3
        for (const c of nearChunks(2)) for (const e of [...c.enemies]) if (e.dim === f.dim && Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z) < 4.5 + e.hr) {
          e.hp -= 6 * dm(); e.hitT = 0.12; fx.spark(new V(e.pos.x, e.pos.y + 1.5, e.pos.z), 4, new V(0, 1, 0), ORANGE); if (e.hp <= 0) killWalker(e)
        }
      }
      if (f.t <= 0) { f.mesh.removeFromParent(); (f.mesh.material as THREE.Material).dispose(); fires.splice(i, 1) }
    }
  }
  // red ground zones: a locked, directional area that will be hit when the timer ends, so you have to leave it
  const zones: { mesh: THREE.Mesh; t: number; T: number; dim: number }[] = []
  const zoneGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const spawnZone = (e: Enemy, ang: number, len: number, wd: number, T: number, at: { x: number; z: number } = e.pos) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff1208, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, side: THREE.DoubleSide }), mesh = new THREE.Mesh(zoneGeo, mat)
    mesh.position.set(at.x + Math.sin(ang) * len / 2, terrainY(at.x + Math.sin(ang) * len / 2, at.z + Math.cos(ang) * len / 2, e.dim) + 0.4, at.z + Math.cos(ang) * len / 2)
    mesh.scale.set(wd, 1, len); mesh.rotation.y = ang; mesh.renderOrder = 5; scene.add(mesh); zones.push({ mesh, t: T, T, dim: e.dim })
  }
  const zoneTick = (dt: number) => {
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i]; z.t -= dt; z.mesh.visible = z.dim === nd(); (z.mesh.material as THREE.MeshBasicMaterial).opacity = 0.34 + 0.5 * (1 - Math.max(0, z.t) / z.T) * (0.7 + 0.3 * Math.sin(time * 24))
      if (z.t <= -0.15) { z.mesh.removeFromParent(); (z.mesh.material as THREE.Material).dispose(); zones.splice(i, 1) }
    }
  }
  const inZone = (e: Enemy, ang: number, len: number, wd: number) => { const ux = Math.sin(ang), uz = Math.cos(ang), px = st.pos.x - e.pos.x, pz = st.pos.z - e.pos.z, along = px * ux + pz * uz, lat = Math.abs(px * uz - pz * ux); return along > -1 && along < len && lat < wd / 2 + 0.7 }
  // the five guardians, one per dimension, each with its own way of fighting
  // bosses step away from planted tnt, so the plant-and-shoot trick has to be sprung on something they cannot see coming
  const tntAvoid = (e: Enemy) => {
    for (const b of bombs) if (b.kind === "tnt" && b.dim === e.dim) { const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z, d2 = Math.hypot(dx, dz); if (d2 < 11) return { x: dx / (d2 || 1), z: dz / (d2 || 1) } }
    return null
  }
  const GUARD_NAMES = ["stomper", "sniper", "summoner", "charger", "blinker"]
  const guardianAI = (e: Enemy, dt: number, dx: number, dz: number, dist: number) => {
    const a = (e.ai ??= {}), v = e.variant ?? 0, ux = dx / dist, uz = dz / dist, from = new V(e.pos.x, e.pos.y + 4, e.pos.z)
    const enr = e.hp < (e.maxHp ?? e.hp) * 0.5
    if (enr && !a.enraged) { a.enraged = 1; banner(`the ${GUARD_NAMES[v]} enrages`, 2); sfx.play("bigboom", e.pos, 1); st.shake = Math.max(st.shake, 0.8) }
    a.t = (a.t ?? 2.5) - dt * (enr ? 1.7 : 1)
    let moving = dist < 90 && dist > 6, mx = ux, mz = uz, spd = 1
    const av = tntAvoid(e); if (av) return { moving: true, mx: av.x, mz: av.z, spd: 2.2 }
    if (e.home && Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z) > 55) { const hx = e.home.x - e.pos.x, hz = e.home.z - e.pos.z, hl = Math.hypot(hx, hz) || 1; mx = hx / hl; mz = hz / hl; moving = true; return { moving, mx, mz, spd } }
    const live = e.dim === nd()
    if (v === 0) { // stomper: raises its fists and marks a long red lane toward you that it will smash when the mark is full; leave the lane or be crushed
      if (a.tele > 0) { moving = false; e.fireT = 0.9
        if ((a.tele -= dt) <= 0) {
          sfx.play("bigboom", e.pos, 1); st.shake = Math.max(st.shake, live ? 0.9 : 0)
          for (let li = 0; li < a.n; li++) { const ang = a["ang" + li]
            for (let k = 0; k < 14; k++) fx.spark(new V(e.pos.x + Math.sin(ang) * (2 + k * 1.8), e.pos.y + 0.5, e.pos.z + Math.cos(ang) * (2 + k * 1.8)), 4, new V(0, 1, 0), DUST)
            if (live && inZone(e, ang, 23.4, 7.2)) { hurtPlayer(e, 36, "crushed by a stomper"); st.vel.x += Math.sin(ang) * 6; st.vel.z += Math.cos(ang) * 6; st.vel.y = 11; st.ground = false }
          }
          if (live && dist < 6.5) { hurtPlayer(e, 20, "crushed by a stomper"); st.vel.y = 9; st.ground = false } } }
      else if (a.t <= 0 && dist < 32) { // aim at where you are heading, lock the lanes, and warn
        a.tele = enr ? 0.9 : 1.15; a.t = 3.2
        const base = Math.atan2(st.pos.x + st.vel.x * 0.35 - e.pos.x, st.pos.z + st.vel.z * 0.35 - e.pos.z), lanes = enr ? [-0.6, 0, 0.6] : [0]
        a.n = lanes.length; lanes.forEach((o, li) => { a["ang" + li] = base + o; spawnZone(e, base + o, 23.4, 7.2, a.tele) })
        sfx.play("surge", e.pos, 0.7) }
    } else if (v === 1) { // sniper: holds a firing range, tracks you with a laser, locks it, then fires along it; between shots it lobs fast lead-aimed bolts
      const los = dist < 80 && sees(e.pos.x, e.pos.z, e.dim), aim = new V(st.pos.x, st.pos.y + 1.2, st.pos.z)
      moving = !los || dist > 40 || dist < 24; if (los && dist < 24) { mx = -ux; mz = -uz } else if (!los) spd = 1.4
      // walled off (the player is on a peak, or behind rock) for too long: it phases to a spot that can see you
      a.blind = los ? 0 : (a.blind ?? 0) + dt
      if (a.blind > 2.5) { a.blind = 0; const a0 = Math.random() * Math.PI * 2; for (let k = 0; k < 16; k++) { const an = a0 + k * Math.PI / 8, rr = 26 + (k % 3) * 5, x = st.pos.x + Math.cos(an) * rr, z = st.pos.z + Math.sin(an) * rr; if (sees(x, z, e.dim)) { fx.spark(from, 30, new V(0, 1, 0), GLOWC[e.dim]); e.pos.x = x; e.pos.z = z; sfx.play("phase", e.pos, 1); break } } }
      if (a.tele > 0) { moving = false
        if (a.tele > 0.4) { a.lx = aim.x; a.ly = aim.y; a.lz = aim.z } // the laser follows you until the last moment
        a.beamT = (a.beamT ?? 0) - dt; if (a.beamT <= 0) { a.beamT = 0.07; const d3 = new V(a.lx, a.ly, a.lz).sub(from).normalize(); beam(from, from.clone().addScaledVector(d3, Math.min(90, dist + 6)), a.tele > 0.4 ? 0.025 : 0.06, 0.1) }
        if ((a.tele -= dt) <= 0) {
          const d3 = new V(a.lx, a.ly, a.lz).sub(from).normalize(), far = from.clone().addScaledVector(d3, 90); beam(from, far, 0.14, 0.3); sfx.play("zap", e.pos, 1.5); st.shake = Math.max(st.shake, 0.3)
          // it hits if you are within 1.8 m of the beam and nothing solid is in the way
          const toP = new V(st.pos.x - from.x, st.pos.y + 1 - from.y, st.pos.z - from.z), along = toP.dot(d3), off = toP.clone().addScaledVector(d3, -along).length()
          let blocked = false; for (const ch of nearChunks(2)) for (const bx of ch.boxes) if (bx.dim === e.dim && rayCollider(from, d3, bx) < along) blocked = true
          if (live && along > 0 && off < 1.8 && !blocked && !parry(e)) hurtPlayer(e, 34, "sniped")
          if (enr && (a.burst = (a.burst ?? 0) + 1) < 3) a.tele = 0.7; else a.burst = 0 } }
      else if (a.t <= 0 && los) { a.tele = 1.15; a.t = enr ? 2.6 : 3.8; a.lx = aim.x; a.ly = aim.y; a.lz = aim.z }
      // spotting bolts: fast, aimed where you are going
      a.sp = (a.sp ?? 1) - dt
      if (a.sp <= 0 && los && !(a.tele > 0)) { a.sp = enr ? 0.65 : 1.05; const lead = dist / 42, tgt = new V(st.pos.x + st.vel.x * lead, st.pos.y + 1.1 + st.vel.y * lead * 0.5, st.pos.z + st.vel.z * lead); spawnShot(e, from, tgt.sub(from), 42, 9); sfx.play("zap", e.pos, 0.6) }
    } else if (v === 2) { // summoner: keeps its distance, calls swarmers, and mends itself while they live
      moving = dist > 30 || dist < 20; if (dist < 20) { mx = -ux; mz = -uz }
      if (a.t <= 0) { a.t = 6; summon("swarmer", 4 + Math.min(4, st.level) + (enr ? 4 : 0), 4, 8, e.dim, 0, Math.PI * 2, e.pos); if (enr) summon("flyer", 2, 6, 10, e.dim, 0, Math.PI * 2, e.pos); sfx.play("phase", e.pos, 0.8) }
      let kids = 0; for (const c of nearChunks(2)) for (const o of c.enemies) if (o.kind === "swarmer" && o.dim === e.dim && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 35) kids++
      if (kids) e.hp = Math.min(e.maxHp ?? e.hp, e.hp + 7 * dt)
    } else if (v === 3) { // charger: telegraphs, rushes in a straight line, then is dazed; if you perch out of its reach it leaps onto your perch
      a.lp = (a.lp ?? 3) - dt
      if (a.leap > 0) { moving = false
        if ((a.leap -= dt) <= 0) {
          sfx.play("bigboom", e.pos, 1); st.shake = Math.max(st.shake, live ? 0.9 : 0); e.pos.x = a.lx; e.pos.z = a.lz
          for (let k = 0; k < 24; k++) { const an = (k / 24) * Math.PI * 2; fx.spark(new V(a.lx + Math.cos(an) * 5, st.pos.y, a.lz + Math.sin(an) * 5), 3, new V(0, 1, 0), DUST) }
          if (live && Math.abs(st.pos.x - a.lx) < 6.6 && Math.abs(st.pos.z - a.lz) < 6.6 && st.pos.y - a.ly < 4) { hurtPlayer(e, 40, "flattened by a charger"); st.vel.x += (st.pos.x - a.lx) * 1.5; st.vel.z += (st.pos.z - a.lz) * 1.5; st.vel.y = 11; st.ground = false } } }
      else if (live && a.lp <= 0 && st.pos.y - e.pos.y > 2.5 && dist < 90 && !(a.chg > 0)) { // perched: mark a square under you, then land on it
        a.lp = enr ? 3 : 4.5; a.leap = enr ? 0.8 : 1.1; a.lx = st.pos.x; a.lz = st.pos.z; a.ly = st.pos.y; spawnZone(e, 0, 12, 12, a.leap, { x: a.lx, z: a.lz - 6 }); sfx.play("surge", e.pos, 0.7) }
      else if (a.stun > 0) { a.stun -= dt; moving = false }
      else if (a.chg > 0) { a.chg -= dt; mx = a.cx; mz = a.cz; spd = 6.5; moving = true
        if (live && dist < 4.5 && a.hit !== 1) { a.hit = 1; hurtPlayer(e, 1e4, "run down by a charger"); st.vel.x += a.cx * 14; st.vel.z += a.cz * 14; st.vel.y = 8; st.ground = false } // a direct hit is lethal
        if (a.chg <= 0) { if (enr && a.chain !== 1) { a.chain = 1; a.tele = 0.45; a.hit = 0; const dd = Math.max(0.01, Math.hypot(st.pos.x - e.pos.x, st.pos.z - e.pos.z)); a.cx = (st.pos.x - e.pos.x) / dd; a.cz = (st.pos.z - e.pos.z) / dd; spawnZone(e, Math.atan2(a.cx, a.cz), 30, 5.5, a.tele) } else { a.chain = 0; a.stun = enr ? 0.6 : 1.6 } } }
      else if (a.tele > 0) { moving = false; if ((a.tele -= dt) <= 0) { a.chg = 1.1; a.hit = 0; sfx.play("surge", e.pos, 1) } }
      else if (a.t <= 0 && dist < 45 && dist > 8) { // lock the lane, mark it red, then run it down
        a.tele = enr ? 0.7 : 0.95; a.t = 5; a.cx = ux; a.cz = uz; spawnZone(e, Math.atan2(ux, uz), 30, 5.5, a.tele) }
    } else { // blinker: hops around you and throws a solid ring of orbs, alternately low (jump it) and high (slide under it); shoot an orb to send it back at the blinker
      moving = false
      if (a.t <= 0) { a.t = enr ? 2.2 : 3.2; const an = Math.random() * Math.PI * 2, rr = 14 + Math.random() * 8
        fx.spark(from, 30, new V(0, 1, 0), GLOWC[e.dim]); e.pos.x = st.pos.x + Math.cos(an) * rr; e.pos.z = st.pos.z + Math.sin(an) * rr; if (e.home) { const hx = e.pos.x - e.home.x, hz = e.pos.z - e.home.z, hd = Math.hypot(hx, hz); if (hd > 42) { e.pos.x = e.home.x + hx / hd * 42; e.pos.z = e.home.z + hz / hd * 42 } }; sfx.play("phase", e.pos, 1)
        a.hi = a.hi ? 0 : 1 // rings alternate: a low one to jump over, a high one to slide under
        const org = new V(e.pos.x, terrainY(st.pos.x, st.pos.z, e.dim) + (a.hi ? 1.4 : 0.45), e.pos.z), nOrb = Math.round(Math.PI * 2 * Math.hypot(st.pos.x - e.pos.x, st.pos.z - e.pos.z) / 2.4)
        for (let k = 0; k < nOrb; k++) { const t2 = (k / nOrb) * Math.PI * 2; spawnShot(e, org, new V(Math.cos(t2), 0, Math.sin(t2)), enr ? 15 : 12, 18, true) }
        a.vol = 0.45 }
      // right after each blink it fires a fast volley aimed where you are heading
      if (a.vol > 0 && (a.vol -= dt) <= 0) { const org = new V(e.pos.x, e.pos.y + 3, e.pos.z), lead = dist / 30; for (let k = -1; k <= 1; k += enr ? 0.5 : 1) { const tgt = new V(st.pos.x + st.vel.x * lead, st.pos.y + 1.1, st.pos.z + st.vel.z * lead), d3 = tgt.sub(org).normalize(); d3.applyAxisAngle(new V(0, 1, 0), k * 0.16); spawnShot(e, org, d3, 30, 22) } sfx.play("zap", e.pos, 0.8) }
    }
    return { moving, mx, mz, spd }
  }
  const spawnGuardian = (py: Pylon) => {
    let best = { x: py.x + 9, z: py.z, c: -1e9 }
    for (let k = 0; k < 8; k++) { const an = (k / 8) * Math.PI * 2, x = py.x + Math.cos(an) * 10, z = py.z + Math.sin(an) * 10, c = clearance(py.dim, x, z); if (c > best.c) best = { x, z, c } }
    const pos = new V(best.x, terrainY(best.x, best.z, py.dim), best.z), e = makeEnemy("guardian", world.foe, py.dim, pos), ch = chunks.get(chunkKey(Math.floor(pos.x / CH), Math.floor(pos.z / CH))); if (!ch) return
    e.variant = py.dim; if (py.dim === 1) { e.r *= 0.47; e.hr *= 0.47; e.h *= 0.47 } e.hp = e.maxHp = 230 * (1 + 0.5 * st.level); e.lv = st.level; e.home = { x: py.x, z: py.z }; e.mesh.position.copy(pos)
    ch.group.add(e.mesh); ch.enemies.push(e); py.guard = e
  }
  const bossDown = (e: Enemy) => {
    for (const sh of shrines.values()) if (sh.boss === e) { sh.state = "done"; sh.boss = null }
    st.level++
    const k = (st.level - 1) % 4, text = ["max health +20", "damage +20%", "move speed +8%", "cooldowns -15%"][k]
    if (k === 0) st.maxHp += 20; else if (k === 1) st.boon.dmg++; else if (k === 2) st.boon.spd++; else st.boon.cd++
    st.hp = st.maxHp; banner(`warden defeated. level ${st.level}. ${text}`, 4.5); sfx.play("ready")
    // the first warden you kill ends the run: freeze the world and hand the stats to the page
    if (!practice && st.wins++ === 0) {
      document.exitPointerLock()
      window.dispatchEvent(new CustomEvent("phase-victory", { detail: { seconds: Math.round(st.runT), deaths: st.deaths, kills: st.kills, powerups: st.items, shrines: st.level, farthest: Math.round(best) } }))
    }
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
          if (py.group && !py.cleared && sh.state === "idle") {
            if (py.guard && !py.guard.mesh.parent) py.guard = null // its chunk unloaded: it respawns
            if (!py.guard) spawnGuardian(py)
            // the guardian defends its crystal: it steps in front of it when you come close
            const g = py.guard, dPy = Math.hypot(p.x - py.x, p.z - py.z)
            if (g && nd() === py.dim && dPy < 16 && Math.hypot(g.pos.x - py.x, g.pos.z - py.z) > 10 && ((g.ai ??= {}).def = (g.ai.def ?? 0) - dt) <= 0) {
              g.ai.def = 5; const ax = (p.x - py.x) / (dPy || 1), az = (p.z - py.z) / (dPy || 1); fx.spark(new V(g.pos.x, g.pos.y + 3, g.pos.z), 30, new V(0, 1, 0), GLOWC[g.dim]); g.pos.x = py.x + ax * 6; g.pos.z = py.z + az * 6; sfx.play("phase", g.pos, 1)
            }
          }
          if (py.group && py.crystal) { py.crystal.rotation.y += dt * 1.6; py.crystal.position.y = py.top + 1.9 + Math.sin(time * 2 + py.i) * 0.18; const hot = sh.state === "idle" && sh.order[sh.next] === py.i; py.crystal.scale.setScalar(hot ? 1 + 0.18 * Math.sin(time * 7) : 1); py.crystal.scale.y *= 1.5 }
          if (sh.state === "idle" && !sh.lit[py.i] && nd() === py.dim && st.deadT <= 0 && py.group && Math.hypot(p.x - py.x, p.z - py.z) < 3.4 && Math.abs(p.y - py.top) < 3.2) {
            if (!py.cleared) { // the guardian still stands: the crystal throws you back
              const ax = p.x - py.x, az = p.z - py.z, al = Math.hypot(ax, az) || 1; st.vel.set(ax / al * 14, 13, az / al * 14); st.ground = false; st.wallT = 0; st.shake = 0.7; sfx.play("hurt"); banner("defeat its guardian first", 2)
            } else if (sh.order[sh.next] === py.i) {
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
    st.focus = best && bd < 260 && best.state === "idle" ? best : null; st.target = best; st.targetD = bd
    let be: Enemy | null = null
    for (const sh of shrines.values()) { if (sh.boss && sh.state === "boss") be = sh.boss; if (!be) for (const py of sh.pylons) if (py.guard && py.guard.hp > 0 && py.guard.dim === nd() && Math.hypot(p.x - py.guard.pos.x, p.z - py.guard.pos.z) < 80) be = py.guard }
    st.bossE = be && be.mesh.parent ? be : null
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
    if (practice) st.hp = st.maxHp
    st.runT += DT
    // each dimension has its own ground: phasing into a higher landscape lifts you onto it instead of burying you
    { const gh = terrainY(st.pos.x, st.pos.z, nd()); if (st.pos.y < gh) { st.pos.y = gh; if (st.vel.y < 0) st.vel.y = 0 } }

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

    if (st.surge > 0) { v.x = st.sdir.x * st.surgeSpd; v.z = st.sdir.z * st.surgeSpd; if (st.sdir.y) v.y = st.sdir.y * st.surgeSpd }
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
    if (berserk() !== st.wasBerserk) { st.wasBerserk = berserk(); if (st.wasBerserk) st.ammo = mag() }
    if (weapon === "sword") {
      if (st.surge > 0) {
        st.surge -= DT / st.surgeLen; st.spin = 1 - Math.max(0, st.surge); surgeCut()
        if (st.surge <= 0) { st.surge = 0; st.fireT = 0.9; st.vel.x = st.sdir.x * 8; st.vel.z = st.sdir.z * 8; if (st.sdir.y) st.vel.y = st.sdir.y * 8 }
      } else if (st.swing > 0) {
        const before = st.swing; st.swing -= DT / (lvl("sword") >= 2 ? SWING / 2 : SWING)
        if (before > 0.55 && st.swing <= 0.55) swingCut()
        if (st.swing <= 0) { st.swing = 0; st.fireT = lvl("sword") >= 2 ? 0 : 0.04 }
      } else if (st.fire && st.fireT <= 0) {
        const before = st.charge; st.charge = Math.min(MAXCHARGE, st.charge + DT); if (before < 0.22 && st.charge >= 0.22) sfx.play("ready")
        if (st.charge >= MAXCHARGE) { if ((st.hold += DT) > SWORD_HOLD) { st.charge = 0; st.hold = 0; st.fireT = FIZZLE; sfx.play("fizzle") } } else st.hold = 0
      }
      else if (st.charge > 0) {
        if (st.charge < 0.22 && st.power?.k !== "whirlwind sword") { st.swing = 1; sfx.play("whoosh"); const f = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)); st.vel.x += f.x * 5; st.vel.z += f.z * 5 }
        else startSurge(Math.max(0.3, st.charge / MAXCHARGE))
        st.charge = 0
      }
    }
    else if (weapon === "pistol") {
      if (st.reload > 0) { st.reload -= DT; if (st.reload <= 0) { st.ammo = mag(); sfx.play("clink") } }
      else if (st.ammo <= 0) startReload()
      else if (st.fire && st.fireT <= 0) { shootPistol(); st.fireT = st.power?.k === "no reload" ? 0.045 : 0.09 }
    }
    else if (st.fire && st.fireT <= 0) {
      if (st.draw === 0) sfx.draw.start(); st.draw = Math.min(1, st.draw + DT / 0.55); sfx.draw.set(st.draw)
      if (st.draw >= 1 && (st.hold += DT) > BOW_HOLD) { sfx.draw.stop(); sfx.play("fizzle"); st.draw = 0; st.hold = 0; st.fireT = FIZZLE }
    }
    else if (st.draw > 0) { if (st.draw > 0.2) { loose(st.draw); st.fireT = 0.4 } else sfx.draw.stop(); st.draw = 0; st.hold = 0 }
    for (let i = arrows.length - 1; i >= 0; i--) { arrowStep(arrows[i], DT); if (arrows[i].life <= 0) { arrows[i].mesh.removeFromParent(); arrows.splice(i, 1) } }
    best = Math.max(best, Math.floor(Math.hypot(p.x, p.z)))
    cpT -= DT
    if (cpT <= 0 && st.ground && st.hp > 40) { cpT = 2; checkpoint = { pos: p.clone(), dim: nd() } }
    if (st.hp <= 0) die(st.cause || "you were killed")
    // safety net: if anything ever drops the player below the world, throw them back up instead of killing them
    else if (p.y < terrainY(p.x, p.z, nd()) - 3) { p.y = terrainY(p.x, p.z, nd()) + 2; st.vel.set(st.vel.x * 0.3, 24, st.vel.z * 0.3); st.ground = false; st.shake = 0.5; sfx.play("whoosh") }
    p.y = Math.min(p.y, 80)
  }

  const keyT: Record<string, number> = {}
  // practice mode: the real game with crawling enemies that cannot hurt you, and a short list of things to try
  let pr = 0, prBase = { x: 0, z: 0, nd: 0, n: 0, kills: 0 }, prT = 0
  const PRACTICE: [string, () => boolean, (() => void)?][] = [
    ["wasd to move, mouse to look", () => Math.hypot(st.pos.x - prBase.x, st.pos.z - prBase.z) > 12],
    ["space to jump, space again in the air to double jump", () => st.jumps >= 1 && !st.ground],
    ["land and jump again right away: bunny hops build speed", () => st.hops >= 2],
    ["hold c while running to slide", () => st.slide],
    ["run into a boulder to wall run, space leaps off", () => st.wallT > 0],
    ["enemies are coming. press e or q, or scroll, to phase into another dimension and slip past them", () => prBase.n >= 1,
      () => { summon("swarmer", 6, 18, 26, nd(), 0, Math.PI * 2); summon("walker", 3, 24, 32, nd(), 0, Math.PI * 2) }],
    ["scroll a little: you peek into the next dimension and see what is there", () => Math.abs(d - Math.round(d)) > 0.25],
    ["keep phasing the same way: the five dimensions loop round", () => prBase.n >= 5],
    ["click to shoot. r reloads", () => st.kills > prBase.kills, () => { summon("walker", 2, 14, 18, nd(), 0, 1) }],
    ["press g to throw a grenade into the crowd (pistol)", () => st.gCd > 0, () => { summon("walker", 3, 14, 20, nd(), 0, 0.6); summon("swarmer", 5, 14, 20, nd(), 0, 0.6) }],
    ["press 2 for the bow, then g to plant tnt where they will pass. plant again on the same spot to stack it", () => st.tnt < 6, () => { summon("walker", 3, 24, 32, nd(), 0, 0.6) }],
    ["draw the bow and shoot the tnt to set it off", () => bombs.every(b => b.kind !== "tnt")],
    ["press 3, hold the mouse to charge the sword and release looking up: you surge where you look", () => st.surge > 0],
    ["that is everything. keep practicing, or press escape and go to the real game", () => prT > 8],
  ]
  // practice keeps a steady trickle of slow enemies coming from every dimension so there is always something to try things on
  let prSpawnT = 0
  const practiceTick = (dt: number) => {
    if (practice && (prSpawnT -= dt) <= 0) {
      prSpawnT = 1.5; let near = 0; for (const c of nearChunks(2)) for (const e of c.enemies) if (e.dim === nd() && Math.hypot(e.pos.x - st.pos.x, e.pos.z - st.pos.z) < 60) near++
      if (near < 60) { const k = Math.random() < 0.5 ? "swarmer" : "walker"; summon(k, k === "swarmer" ? 3 : 2, 22, 40, nd(), 0, Math.PI * 2) }
    }
    if (!practice || pr >= PRACTICE.length) return
    prT += dt; if (nd() !== prBase.nd) { prBase.nd = nd(); prBase.n++ }
    if (PRACTICE[pr][1]()) { pr++; prT = 0; prBase = { x: st.pos.x, z: st.pos.z, nd: nd(), n: 0, kills: st.kills }; sfx.play("ready"); if (pr < PRACTICE.length) PRACTICE[pr][2]?.() }
  }
  const frame = (w: number, h: number, dt: number) => {
    time += dt; uTime.value = time; practiceTick(dt)
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
    for (const c of chunks.values()) for (const e of c.enemies) e.mesh.visible = (gap(e.dim) < 1.1 || e.kind === "boss") && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < (e.kind === "boss" ? 400 : 60)
    for (const c of chunks.values()) {
      const r = ring(c)
      if (c.detail) c.detail.visible = r <= 1
      c.lods.hi.forEach(o => (o.visible = r <= 1)); c.lods.lo.forEach(o => (o.visible = r > 1))
    }
    // the dimension you are sliding toward shows as a faint ghost, and its enemies glow through walls so you can scout them
    for (let i = 0; i < N; i++) {
      const a0 = Math.max(0, 1 - gap(i) * 1.15), solid = i === nd()
      for (const m of registry[i]) {
        // trees, plants and grass stand on their own dimension's ground, so as ghosts in another dimension they would float over yours: hide them
        if (!solid && m.userData.flora) { m.visible = false; continue }
        const a = m.userData.always ? Math.max(a0, 0.55) : a0 // the warden shows through every dimension as a ghost
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
    if (!dbg.hideHud && st.power) { ctx.fillStyle = "#a8f4ff"; ctx.font = "700 16px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.fillText(`${st.power.k}  ${Math.ceil(st.power.t)}s`, w - 30, h - 62); ctx.textAlign = "left" }
    if (!dbg.hideHud && weapon === "pistol") { ctx.fillStyle = st.ammo <= 3 || st.reload > 0 ? "#e8c36a" : "#fff"; ctx.font = "700 22px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.fillText(st.reload > 0 ? "reloading" : `${st.ammo} / ${mag()}`, w - 30, h - 30); ctx.textAlign = "left" }
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
        ctx.fillText(e.kind === "guardian" ? `guardian: ${GUARD_NAMES[e.variant ?? 0]}` : `the warden${warn ? "   shifting!" : ""}${e.dim === nd() ? "" : "   phase to its dimension"}`, w / 2, 45)
      }
      // the arrow points at the warden while it hunts you, otherwise always at the next beacon (a guardian's bar sits above it and does not change the arrow)
      const oy = st.bossE ? 38 : 0, wd = st.bossE?.kind === "boss" ? st.bossE : null
      if (wd) {
        const e = wd
        // an arrow to it, tinted by the dimension it is in now, with the distance
        const rb = Math.atan2(e.pos.x - p.x, -(e.pos.z - p.z)) - (-st.yaw), angb = Math.atan2(Math.sin(rb), Math.cos(rb)), colb = hexs(GLOW[e.dim]), lb = `${Math.round(Math.hypot(e.pos.x - p.x, e.pos.z - p.z))} m`
        ctx.save(); ctx.translate(w / 2, 100); ctx.rotate(angb); ctx.fillStyle = colb; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 8); ctx.lineTo(0, 3); ctx.lineTo(-9, 8); ctx.closePath(); ctx.fill(); ctx.restore()
        ctx.font = "14px ui-monospace, monospace"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.strokeText(lb, w / 2, 130); ctx.fillStyle = colb; ctx.fillText(lb, w / 2, 130)
      } else if (st.focus) {
        // only the next beacon matters: an arrow to it, tinted by its dimension, with that dimension's number and the distance
        const s2 = st.focus, py = s2.pylons[s2.order[Math.min(s2.next, N - 1)]], rel2 = Math.atan2(py.x - p.x, -(py.z - p.z)) - (-st.yaw), ang2 = Math.atan2(Math.sin(rel2), Math.cos(rel2)), col = hexs(GLOW[py.dim])
        ctx.save(); ctx.translate(w / 2, 62 + oy); ctx.rotate(ang2); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 8); ctx.lineTo(0, 3); ctx.lineTo(-9, 8); ctx.closePath(); ctx.fill(); ctx.restore()
        ctx.font = "14px ui-monospace, monospace"; const lbl = `${Math.round(Math.hypot(py.x - p.x, py.z - p.z))} m`; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.strokeText(lbl, w / 2, 92 + oy); ctx.fillStyle = col; ctx.fillText(lbl, w / 2, 92 + oy)
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
    if (dbg.showKeys || practice) {
      const now = performance.now(), lit = (c: string) => keys.has(c) || now - (keyT[c] ?? -1e9) < 260, caps: [string, string, number][] = [["KeyQ", "q", 44], ["KeyE", "e", 44], ["", "", 20], ["KeyW", "w", 44], ["KeyA", "a", 44], ["KeyS", "s", 44], ["KeyD", "d", 44], ["", "", 20], ["Space", "space", 96], ["KeyC", "c", 44], ["", "", 20], ["Wheel", "scroll", 84]]
      let x = w / 2 - caps.reduce((a, c) => a + c[2] + 6, 0) / 2, y = h - 72; ctx.textAlign = "center"; ctx.font = "17px ui-monospace, monospace"
      for (const [c, label, cw] of caps) { if (c) { const on = c === "Wheel" ? now - lastWheel < 260 : lit(c); ctx.fillStyle = on ? "#fff" : "rgba(0,0,0,0.45)"; ctx.fillRect(x, y, cw, 44); ctx.fillStyle = on ? "#111" : "rgba(255,255,255,0.85)"; ctx.fillText(label, x + cw / 2, y + 28) } x += cw + 6 }
      ctx.textAlign = "left"
    }
    if (practice && pr < PRACTICE.length) { ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "13px ui-monospace, monospace"; ctx.fillText(`practice ${pr + 1}/${PRACTICE.length}`, w / 2, h - 96); ctx.fillStyle = "#fff"; ctx.font = "700 22px ui-sans-serif, system-ui, sans-serif"; ctx.shadowBlur = 8; ctx.fillText(PRACTICE[pr][0], w / 2, h - 124); ctx.shadowBlur = 3; ctx.textAlign = "left" }
  }

  let raf = 0, last = performance.now(), acc = 0
  let calm = 0, lastNd = 2
  let started = false, manual = false, scale = 1, ema = 1 / 60, frames = 0, lastWheel = 0
  let wasLive = false
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
    // the world waits on the menu and whenever the pointer is released
    const live = manual || (started && !!document.pointerLockElement)
    if (live) {
      while (acc > DT) { acc -= DT; step() }
      enemyTick(Math.min(dt, 0.05)); separate(); bombStep(Math.min(dt, 0.05)); shrineTick(Math.min(dt, 0.05)); stream()
    } else { acc = 0; if (wasLive) sfx.draw.stop() }
    wasLive = live
    // paused frames still draw, but with no time passing: no footsteps, bob, sway or sound effects keep running under the menu
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); frame(w, h, live ? dt : 0)
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
  ;(window as unknown as { __g: unknown }).__g = { buy, parrying, shots, rayCollider, arrows, practiceStep: (n?: number) => (n === undefined ? pr : (pr = n)), st, chunks, genMs, groundH: (x: number, z: number) => terrainY(x, z, nd()), keys, vm: bow, pistol, sword, bombs, explode, makeSfx, sfx, summon, shrines, getShrine, killWalker, startBoss,  getNd: () => nd(), getWeapon: () => weapon, sword2: sword, sunDir: SUN, hurts, dbg, cam, scene, renderer, post, getScale: () => scale, tick, setDim: (v: number) => (target = v + N * Math.round((d - v) / N)), setManual: (v: boolean) => (manual = v) }

  const kd = (e: KeyboardEvent) => {
    sfx.init()
    if (e.code === "Space") e.preventDefault()
    if (e.code === "Digit1") swap("pistol"); if (e.code === "Digit2") swap("bow"); if (e.code === "Digit3") swap("sword"); if (e.code === "KeyG" && !e.repeat) { if (weapon === "pistol") throwGrenade(); else if (weapon === "bow") placeTnt() }
    if (e.code === "KeyM" && !e.repeat) sfx.toggleMute()
    if (e.code === "KeyF") swap(weapon === "pistol" ? "bow" : weapon === "bow" ? "sword" : "pistol")
    keyT[e.code] = performance.now()
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
  return { buy, begin: () => { started = true }, harder: () => { st.level += 2; banner("endless: every enemy is tougher", 4) }, stop: () => {
    cancelAnimationFrame(raf); post.composer.dispose(); renderer.dispose()
    removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mousemove", mm)
    removeEventListener("mousedown", md); removeEventListener("mouseup", mu); removeEventListener("contextmenu", noMenu)
    removeEventListener("wheel", wh); canvas.removeEventListener("click", click)
  } }
}
