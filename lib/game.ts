import * as THREE from "three"
import { makePost } from "./post"
import { loadSky, loadPistol } from "./assets"
import { flashTexture } from "./textures"
import { makeFx } from "./fx"
import { Enemy } from "./actors"
import { makeViewmodel } from "./viewmodel"
import { makePistol } from "./pistol"
import { makeSword } from "./sword"
import { N, terrainY } from "./materials"
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

export async function startGame(canvas: HTMLCanvasElement, hud: HTMLCanvasElement, signal: AbortSignal) {
  if (signal.aborted) return () => {}
  const ctx = hud.getContext("2d")!
  hud.width = 800; hud.height = 60; ctx.fillStyle = "#fff"; ctx.font = "20px ui-monospace, monospace"; ctx.fillText("loading assets", 20, 40)
  const [world, sky, pistolModel] = await Promise.all([loadWorld(), loadSky(), loadPistol()])
  if (signal.aborted) return () => {}
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  const scene = new THREE.Scene()
  scene.background = sky.tex; scene.environmentIntensity = 1
  const az = (v: THREE.Vector3) => Math.atan2(v.z, v.x), spin = az(sky.sun) - az(new THREE.Vector3(-0.9, 0, -0.3))
  scene.backgroundRotation.y = spin
  // the sky has nothing below the horizon, so bake a grassy ground into the reflection environment too
  const envScene = new THREE.Scene(); envScene.background = sky.tex; envScene.backgroundRotation.y = spin
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6b7a3a).multiplyScalar(0.7) }))
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1; envScene.add(ground)
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.02).texture
  const SUN = sky.sun.clone().applyEuler(scene.backgroundRotation)
  scene.fog = new THREE.FogExp2(0xbdd0e4, 0.0034)
  const cam = new THREE.PerspectiveCamera(85, 1, 0.05, 1000)
  cam.rotation.order = "YXZ"; scene.add(cam)
  scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x6a5a38, 1.15))
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.4)
  sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 200 })
  renderer.shadowMap.autoUpdate = false
  scene.add(sun, sun.target)

  const post = makePost(renderer, scene, cam)

  const dbg = { freezeVm: false, hideHint: false }
  const fx = makeFx(scene), bow = makeViewmodel(world.metal), pistol = makePistol(flashTexture(), pistolModel, world.metal)
  const sword = makeSword(world.metal)
  type Weapon = "pistol" | "bow" | "sword"
  let weapon: Weapon = "pistol"
  const swordPivot = new THREE.Group(); swordPivot.position.set(0, -0.4, 0); swordPivot.add(sword.root); swordPivot.visible = false
  cam.add(bow.root, pistol.root, swordPivot); bow.root.visible = false
  const swap = (w: Weapon) => { if (w === weapon) return; weapon = w; st.draw = 0; st.swing = 0; st.fireT = 0.25; bow.root.visible = w === "bow"; pistol.root.visible = w === "pistol"; swordPivot.visible = w === "sword" }
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb04a).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6)

  const chunks = new Map<string, Chunk>()
  const genMs: number[] = []
  let budget = 0
  const st = { pos: new V(0, terrainY(0, 0) + 0.05, 0), vel: new V(), yaw: 0, pitch: 0, ground: false, jumps: 0, slide: false, coyote: 0,
    wallT: 0, wallCD: 0, contact: 0, wn: new V(), hp: 100, kills: 0, fireT: 0, draw: 0, swing: 0, swingSide: 1, swingA: 0.3, swingHit: false, hit: 0, hurt: 0, kick: 0, roll: 0, flash: 0, bob: 0,
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
  const over = (b: Box, h: number) => { const p = st.pos
    return p.x + 0.3 > b.min.x && p.x - 0.3 < b.max.x && p.y + h > b.min.y && p.y < b.max.y && p.z + 0.3 > b.min.z && p.z - 0.3 < b.max.z }
  const move = (axis: Axis, h: number, bx: Box[]) => {
    const v = st.vel[axis]; let n = 0
    st.pos[axis] += v * DT
    for (const b of bx) if (over(b, h)) {
      const e = axis === "y" ? h : 0.3
      st.pos[axis] = v > 0 ? b.min[axis] - e : b.max[axis] + (axis === "y" ? 0 : 0.3)
      n = v > 0 ? -1 : 1
    }
    if (axis === "y" && v <= 0) { const gh = groundH(st.pos.x, st.pos.z); if (st.pos.y < gh) { st.pos.y = gh; n = 1 } }
    if (n) st.vel[axis] = 0
    return n
  }
  // when a phase leaves the player inside geometry, shove out through the nearest face
  const pushOut = (b: Box, h: number) => {
    const p = st.pos, c = [b.max.x - (p.x - 0.3), p.x + 0.3 - b.min.x, b.max.z - (p.z - 0.3), p.z + 0.3 - b.min.z, b.max.y - p.y, p.y + h - b.min.y], k = c.indexOf(Math.min(...c))
    if (k === 0) p.x = b.max.x + 0.3; else if (k === 1) p.x = b.min.x - 0.3; else if (k === 2) p.z = b.max.z + 0.3; else if (k === 3) p.z = b.min.z - 0.3; else if (k === 4) p.y = b.max.y; else p.y = b.min.y - h
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
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    const mesh = new THREE.Group(); mesh.add(new THREE.Mesh(arrowGeo.shaft, arrowMat.shaft), new THREE.Mesh(arrowGeo.head, arrowMat.head))
    mesh.position.copy(o).addScaledVector(dir, 0.8).add(new V(0.12, -0.12, 0).applyQuaternion(cam.quaternion)); mesh.quaternion.setFromUnitVectors(new V(0, 0, -1), dir); scene.add(mesh)
    arrows.push({ mesh, vel: dir.clone().multiplyScalar(26 + 52 * power).add(st.vel.clone().multiplyScalar(0.35)), dim: nd(), power, life: 6, stuck: false })
    st.kick = 1.6
  }
  const shootPistol = () => {
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    dir.x += (Math.random() - 0.5) * 0.012; dir.y += (Math.random() - 0.5) * 0.012; dir.normalize()
    let tMin = 150, hit: Enemy | null = null
    for (const c of chunks.values()) for (const b of c.boxes) if (b.dim === nd()) tMin = Math.min(tMin, rayBox(o, dir, b.min, b.max))
    for (let t = 1; t < tMin; t += 1.5) if (o.y + dir.y * t < terrainY(o.x + dir.x * t, o.z + dir.z * t)) { tMin = t; break }
    for (const c of nearChunks(2)) for (const e of c.enemies) if (e.dim === nd()) {
      const t = rayBox(o, dir, ...hitBox(e))
      if (t < tMin) { tMin = t; hit = e }
    }
    const end = o.clone().addScaledVector(dir, tMin), mz = pistol.muzzle.getWorldPosition(new V())
    if (hit) {
      st.hit = 0.12; hit.hitT = 0.14; fx.spark(end, 10, dir.clone().negate(), ORANGE); fx.smoke(end, 1, DUST, 0.5)
      if (--hit.hp <= 0) {
        const c = hit.pos.clone().setY(hit.pos.y + 1.6)
        fx.spark(c, 90, new V(0, 1, 0), ORANGE); fx.smoke(c, 10, new THREE.Color(0x2a2a2a), 1.4); boom.position.copy(c); boom.intensity = 60; hit.mesh.removeFromParent(); st.kills++
        for (const c of nearChunks(2)) c.enemies = c.enemies.filter(e => e !== hit)
      }
    } else if (tMin < 150) { fx.spark(end, 6, dir.clone().negate(), DUST); fx.smoke(end, 2, DUST, 0.6) }
    beam(mz, end, 0.012, 0.05)
    const right = new V(1, 0, 0).applyQuaternion(cam.quaternion), up = new V(0, 1, 0).applyQuaternion(cam.quaternion)
    fx.casing(pistol.eject.clone().add(pistol.root.position).applyMatrix4(cam.matrixWorld), right.multiplyScalar(2 + Math.random()).addScaledVector(up, 1.5 + Math.random()).addScaledVector(st.vel, 0.3))
    st.kick = 1; st.flash = 0.05; pistol.flash.material.rotation = Math.random() * 6
  }
  // sword: a swing lasts 0.42 s and cuts at its midpoint, hitting every walker of this dimension inside the arc in front of you
  const SWING = 0.6
  const swingCut = () => {
    const p = st.pos, fwd = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)); let any = false
    for (const c of nearChunks(1)) for (const e of [...c.enemies]) {
      if (e.dim !== nd()) continue
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, dist = Math.hypot(dx, dz)
      if (dist > 6.5 || (dist > 1.8 && (dx * fwd.x + dz * fwd.z) / dist < 0.1)) continue
      any = true; e.hp -= 8; e.hitT = 0.2; e.pos.x += dx / dist * 1.2; e.pos.z += dz / dist * 1.2
      fx.spark(new V(e.pos.x, e.pos.y + 1.7, e.pos.z), 28, new V(-dx / dist, 0.5, -dz / dist), ORANGE); fx.smoke(new V(e.pos.x, e.pos.y + 1.7, e.pos.z), 1, DUST, 0.6)
      if (e.hp <= 0) killWalker(e)
    }
    if (any) { st.hit = 0.15; st.kick = 1.4 }
  }
  const killWalker = (e: Enemy) => {
    const c = e.pos.clone().setY(e.pos.y + 1.6)
    fx.spark(c, 90, new V(0, 1, 0), ORANGE); fx.smoke(c, 10, new THREE.Color(0x2a2a2a), 1.4); boom.position.copy(c); boom.intensity = 60; e.mesh.removeFromParent(); st.kills++
    for (const ch of nearChunks(3)) ch.enemies = ch.enemies.filter(x => x !== e)
  }
  const arrowStep = (a: Arrow, dt: number) => {
    if (a.stuck) { a.life -= dt; return }
    a.life -= dt
    const p = a.mesh.position, dir = a.vel.clone().normalize(), len = a.vel.length() * dt, ch = nearChunks(3)
    let tMin = len, hit: Enemy | null = null
    for (const c of ch) for (const b of c.boxes) if (b.dim === a.dim) tMin = Math.min(tMin, rayBox(p, dir, b.min, b.max))
    for (const c of ch) for (const e of c.enemies) if (e.dim === a.dim) { const t = rayBox(p, dir, ...hitBox(e)); if (t < tMin) { tMin = t; hit = e } }
    const end = p.clone().addScaledVector(dir, Math.min(tMin, len))
    const gy = terrainY(end.x, end.z), onTerrain = end.y < gy
    if (tMin < len || onTerrain) {
      a.stuck = true; a.life = 5; p.copy(end); if (onTerrain) p.y = gy
      if (hit) { st.hit = 0.15; hit.hitT = 0.14; hit.hp -= 4 + 12 * a.power * a.power; fx.spark(end, 14, dir.clone().negate(), ORANGE); fx.smoke(end, 1, DUST, 0.5); if (hit.hp <= 0) killWalker(hit); a.life = 0 }
      else { fx.spark(end, 5, dir.clone().negate(), DUST); fx.smoke(end, 2, DUST, 0.6) }
      return
    }
    p.copy(end); a.vel.y -= 13 * dt; a.mesh.quaternion.setFromUnitVectors(new V(0, 0, -1), a.vel.clone().normalize())
  }

  // each hit remembers where it came from in the world, so the flash can point at the shooter as the player turns
  const hurts: { x: number; z: number; t: number }[] = []
  // a walker can only shoot when no wall of its dimension lies between it and the player
  const clearShot = (e: Enemy) => {
    const from = new V(e.pos.x, e.pos.y + 2.4, e.pos.z), to = new V(st.pos.x, st.pos.y + 1.2, st.pos.z), dir = to.clone().sub(from), len = dir.length(); dir.normalize()
    for (const ch of nearChunks(2)) for (const b of ch.boxes) if (b.dim === e.dim && rayBox(from, dir, b.min, b.max) < len) return false
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
        beam(from, to, 0.03, 0.12)
        if (Math.random() < 0.55) { st.hp -= 9; st.hurt = 0.35; hurts.push({ x: e.pos.x - p.x, z: e.pos.z - p.z, t: 1 }); fx.spark(to, 6, new V(0, 1, 0), ORANGE) }
      }
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
    for (const b of bx) if (over(b, st.slide ? 1 : 1.8)) pushOut(b, st.slide ? 1 : 1.8)

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
        st.jumps = 1; st.slide = false; st.coyote = 0
      } else if (st.wallT > 0) { v.addScaledVector(st.wn, 9); v.y = 9; st.wallT = 0; st.wallCD = 0.3; st.jumps = 1 }
      else if (st.jumps < 2) { v.y = 7.5; st.jumps = 2 }
    }

    if (st.wallT > 0 && (!on("KeyW") || st.contact <= 0)) { st.wallT = 0; st.wallCD = 0.3 }
    if (st.wallT > 0 && (st.wallT -= DT) <= 0) st.wallCD = 0.6
    if (st.wallT > 0) {
      const tan = new V(-st.wn.z, 0, st.wn.x); if (tan.dot(fwd) < 0) tan.negate()
      v.copy(tan).multiplyScalar(Math.max(12, Math.abs(v.dot(tan)))).addScaledVector(st.wn, -3)
    } else v.y -= G * DT * (glide ? 0.08 : 1)
    st.wallCD -= DT

    const h = st.slide ? 1 : 1.8
    const nx = move("x", h, bx), nz = move("z", h, bx), ny = move("y", h, bx)
    st.ground = ny > 0
    if (st.ground) { st.jumps = 0; st.wallT = 0 }
    st.contact = nx || nz ? 0.15 : st.contact - DT
    if (!st.ground && st.wallCD <= 0 && st.wallT <= 0 && (nx || nz) && on("KeyW")) { st.wn.set(nx, 0, nz); st.wallT = 1.4 }

    st.fireT -= DT
    if (weapon === "sword") {
      if (st.swing > 0) {
        const before = st.swing; st.swing -= DT / SWING
        if (!st.swingHit && before > 0.55 && st.swing <= 0.55) { st.swingHit = true; swingCut() }
        if (st.swing <= 0) { st.swing = 0; st.fireT = 0.06 }
      } else if (st.fire && st.fireT <= 0) { st.swing = 1; st.swingSide = st.swingA >= 0 ? 1 : -1; st.swingHit = false; const f = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)); st.vel.x += f.x * 6; st.vel.z += f.z * 6 }
    }
    else if (weapon === "pistol") { if (st.fire && st.fireT <= 0) { shootPistol(); st.fireT = 0.09 } }
    else if (st.fire && st.fireT <= 0) st.draw = Math.min(1, st.draw + DT / 0.55)
    else if (st.draw > 0) { if (st.draw > 0.2) { loose(st.draw); st.fireT = 0.4 } st.draw = 0 }
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
    if (!dbg.freezeVm) cam.position.set(p.x, p.y + (st.slide ? 0.7 : 1.6) + Math.sin(st.bob * 1.3) * 0.025 * Math.min(1, speed / 10), p.z)
    if (!dbg.freezeVm) cam.rotation.set(st.pitch, st.yaw, st.roll)
    cam.fov += (80 - (weapon === "bow" ? st.draw : 0) * 14 + Math.min(speed, 20) * 0.9 - cam.fov) * Math.min(1, 6 * dt); cam.updateProjectionMatrix()
    if (!dbg.freezeVm) {
      const sway = st.lookX * 0.4, lift = st.lookY * 0.4, bobY = Math.abs(Math.sin(st.bob * 1.3)) * 0.006 - (st.slide ? 0.03 : 0)
      if (weapon === "sword") {
        // wind up on the near side, slash across the whole screen to the far side, then recover; the next swing starts from where this one ended
        const t = 1 - st.swing, S = st.swingSide, sm = (u: number) => u * u * (3 - 2 * u), eo = (u: number) => 1 - (1 - u) * (1 - u)
        let a: number, lift: number
        if (st.swing <= 0) { st.swingA += (0.3 - st.swingA) * Math.min(1, dt * 1.6); a = st.swingA; lift = 0 }
        else if (t < 0.24) { const u = eo(t / 0.24); a = S * (0.35 + 0.75 * u); lift = u }
        else if (t < 0.7) { const u = sm((t - 0.24) / 0.46); a = S * (1.1 - 2.35 * u); lift = 1 - u * 1.3 }
        else { const u = eo((t - 0.7) / 0.3); a = -S * (1.25 - 0.85 * u); lift = -0.3 * (1 - u) }
        if (st.swing > 0) st.swingA = a
        // the blade points forward and up; yawing the pivot about the body sweeps its tip across the whole view
        swordPivot.position.set(0, -0.42, 0.1)
        swordPivot.rotation.set(st.lookY * 0.8, -a * 0.95 - st.lookX * 0.8, 0, "YXZ")
        sword.root.position.set(0.05 + sway, 0.02 + bobY, -0.45)
        sword.root.rotation.set(-1.05 + lift * 0.5, 0, a * 0.5 + (st.slide ? -0.12 : 0), "YXZ")
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
    uPlayer.value.copy(p)
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
    post.update(SUN, d, time); post.composer.render()

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
    ctx.fillStyle = "#fff"; ctx.font = "14px ui-monospace, monospace"
    ctx.fillText(`${Math.round(Math.hypot(p.x, p.z))} m from start   ${st.kills} kills   furthest ${best} m   ${Math.round(speed * 3.6)} km/h`, 20, 30)
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(20, h - 30, 160, 4)
    ctx.fillStyle = "#e8c36a"; ctx.fillRect(20, h - 30, Math.max(0, st.hp) * 1.6, 4)
    for (let i = 0; i < N; i++) { ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(w - 24, h / 2 - 120 + i * 60, 8, 1) }
    ctx.fillStyle = "#fff"; ctx.fillRect(w - 28, h / 2 - 120 + d * 60, 16, 2)
    if (!document.pointerLockElement && !manual && !dbg.hideHint) ctx.fillText("click to play. wasd move, mouse aim, click: pistol shoots, bow draws and looses, sword swings. 1 pistol, 2 bow, 3 sword, wheel phase, space jump, c slide, c+space bullet jump, hold right click glide, wall: run into it", 20, h - 50)
  }

  let raf = 0, last = performance.now(), acc = 0
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
    enemyTick(Math.min(dt, 0.05)); stream()
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
  ;(window as unknown as { __g: unknown }).__g = { st, chunks, genMs, groundH, keys, vm: bow, pistol, sword, hurts, dbg, cam, scene, renderer, post, getScale: () => scale, tick, setDim: (v: number) => (target = v), setManual: (v: boolean) => (manual = v) }

  const kd = (e: KeyboardEvent) => {
    if (e.code === "Space") e.preventDefault()
    if (e.code === "Digit1") swap("pistol"); if (e.code === "Digit2") swap("bow"); if (e.code === "Digit3") swap("sword"); if (e.code === "KeyF") swap(weapon === "pistol" ? "bow" : weapon === "bow" ? "sword" : "pistol")
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
  const click = () => { if (!document.pointerLockElement) canvas.requestPointerLock() }
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
