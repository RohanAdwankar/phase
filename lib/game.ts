import * as THREE from "three"
import { makePost } from "./post"
import { loadSky, loadPistol } from "./assets"
import { flashTexture } from "./textures"
import { makeFx } from "./fx"
import { Enemy } from "./actors"
import { makeViewmodel } from "./viewmodel"
import { N, terrainY } from "./materials"
import { buildSegment, disposeSegment, loadWorld, Box, Seg, HW, SEG } from "./world"
import { registry, uTime, uPlayer } from "./materials"

const V = THREE.Vector3
type Axis = "x" | "y" | "z"
const DT = 1 / 120, G = 24, SPEED = 10
const ORANGE = new THREE.Color(0xff9a30), DUST = new THREE.Color(0xe8d9b0)

const rng = (s: number) => () => {
  s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
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
  const [world, sky, pistol] = await Promise.all([loadWorld(), loadSky(), loadPistol()])
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
  const fx = makeFx(scene), vm = makeViewmodel(flashTexture(), pistol, world.metal)
  cam.add(vm.root)
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb04a).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6)

  const segs = new Map<number, Seg>()
  const genMs: number[] = []
  const gen = (i: number) => { const t = performance.now(); segs.set(i, buildSegment(scene, world, i, rng(i * 7919 + 13))); genMs.push(Math.round(performance.now() - t)) }
  const st = { pos: new V(0, 0.01, -4), vel: new V(), yaw: 0, pitch: 0, ground: false, jumps: 0, slide: false, coyote: 0,
    wallT: 0, wallCD: 0, contact: 0, wn: new V(), hp: 100, kills: 0, fireT: 0, hit: 0, hurt: 0, kick: 0, roll: 0, flash: 0, bob: 0,
    jump: false, fire: false, glide: false, lookX: 0, lookY: 0 }
  let d = 2, target = 2, best = 0, time = 0
  const keys = new Set<string>()
  const on = (c: string) => keys.has(c)
  const nd = () => Math.round(d)
  const segAt = () => Math.max(0, Math.floor(-st.pos.z / SEG))
  const nearSegs = () => [segAt() - 1, segAt(), segAt() + 1].flatMap(j => segs.get(j) ?? [])
  const nearBoxes = () => nearSegs().flatMap(s => s.boxes).filter(b => b.dim === nd())
  const top = (b: Box) => (b.floor ? terrainY(st.pos.x, st.pos.z) : b.max.y)
  const over = (b: Box, h: number) => { const p = st.pos
    return p.x + 0.3 > b.min.x && p.x - 0.3 < b.max.x && p.y + h > b.min.y && p.y < top(b) && p.z + 0.3 > b.min.z && p.z - 0.3 < b.max.z }
  const move = (axis: Axis, h: number, bx: Box[]) => {
    const v = st.vel[axis]; let n = 0
    st.pos[axis] += v * DT
    for (const b of bx) if (over(b, h) && (axis === "y" || !b.floor)) {
      const e = axis === "y" ? h : 0.3
      st.pos[axis] = v > 0 ? b.min[axis] - e : (axis === "y" ? top(b) : b.max[axis] + 0.3)
      n = v > 0 ? -1 : 1
    }
    if (n) st.vel[axis] = 0
    return n
  }
  const respawn = () => {
    const s = segs.get(segAt())!
    st.pos.set(0, terrainY(0, s.z0 - 3) + 0.05, s.z0 - 3); st.vel.set(0, 0, 0); st.hp = 100; st.wallT = 0
    d = target = s.clear
  }

  const boom = new THREE.PointLight(0xffa040, 0, 30); scene.add(boom)
  const beams: { mesh: THREE.Mesh; life: number }[] = []
  const beam = (a: THREE.Vector3, b: THREE.Vector3, r: number, life: number) => {
    const mesh = new THREE.Mesh(beamGeo, beamMat), len = a.distanceTo(b)
    mesh.position.copy(a).lerp(b, 0.5); mesh.scale.set(r, len, r)
    mesh.quaternion.setFromUnitVectors(new V(0, 1, 0), b.clone().sub(a).normalize())
    scene.add(mesh); beams.push({ mesh, life })
  }
  const hitBox = (e: Enemy) => [new V(e.pos.x - 1.15, e.pos.y, e.pos.z - 1.15), new V(e.pos.x + 1.15, e.pos.y + 2.9, e.pos.z + 1.15)] as const

  const shoot = () => {
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    dir.x += (Math.random() - 0.5) * 0.012; dir.y += (Math.random() - 0.5) * 0.012; dir.normalize()
    let tMin = 150, hit: Enemy | null = null
    for (const b of nearBoxes()) if (!b.floor) tMin = Math.min(tMin, rayBox(o, dir, b.min, b.max))
    if (dir.y < -1e-3) tMin = Math.min(tMin, (terrainY(o.x + dir.x * 8, o.z + dir.z * 8) - o.y) / dir.y)
    for (const s of nearSegs()) for (const e of s.enemies) if (e.dim === nd()) {
      const t = rayBox(o, dir, ...hitBox(e))
      if (t < tMin) { tMin = t; hit = e }
    }
    const end = o.clone().addScaledVector(dir, tMin), mz = vm.muzzle.getWorldPosition(new V())
    if (hit) {
      st.hit = 0.12; hit.hitT = 0.14; fx.spark(end, 10, dir.clone().negate(), ORANGE); fx.smoke(end, 1, DUST, 0.5)
      if (--hit.hp <= 0) {
        const c = hit.pos.clone().setY(hit.pos.y + 1.6)
        fx.spark(c, 90, new V(0, 1, 0), ORANGE); fx.smoke(c, 10, new THREE.Color(0x2a2a2a), 1.4); boom.position.copy(c); boom.intensity = 60; hit.mesh.removeFromParent(); st.kills++
        for (const s of nearSegs()) s.enemies = s.enemies.filter(e => e !== hit)
      }
    } else if (tMin < 150) { fx.spark(end, 6, dir.clone().negate(), DUST); fx.smoke(end, 2, DUST, 0.6) }
    beam(mz, end, 0.012, 0.05)
    const right = new V(1, 0, 0).applyQuaternion(cam.quaternion), up = new V(0, 1, 0).applyQuaternion(cam.quaternion)
    fx.casing(vm.eject.clone().add(vm.root.position).applyMatrix4(cam.matrixWorld), right.multiplyScalar(2 + Math.random()).addScaledVector(up, 1.5 + Math.random()).addScaledVector(st.vel, 0.3))
    st.kick = 1; st.flash = 0.05; vm.flash.material.rotation = Math.random() * 6
  }

  const step = () => {
    const p = st.pos, v = st.vel, bx = nearBoxes()
    const fwd = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)), right = new V(Math.cos(st.yaw), 0, -Math.sin(st.yaw))
    const wish = new V().addScaledVector(fwd, +on("KeyW") - +on("KeyS")).addScaledVector(right, +on("KeyD") - +on("KeyA"))
    if (wish.lengthSq() > 0) wish.normalize()
    const crouch = on("KeyC") || on("ControlLeft") || on("ShiftLeft")
    d += (target - d) * Math.min(1, 16 * DT)
    for (const b of bx) if (over(b, 1.8)) p.y = top(b)

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
    if (st.fire && st.fireT <= 0) { shoot(); st.fireT = 0.09 }
    for (const s of nearSegs()) for (const e of s.enemies) {
      const dx = p.x - e.pos.x, dz = p.z - e.pos.z, dist = Math.hypot(dx, dz)
      e.mesh.rotation.y = Math.atan2(-dx, -dz); e.pos.y = terrainY(e.pos.x, e.pos.z)
      const moving = dist < 70 && dist > 9
      e.update(DT, moving, time * 5)
      if (e.hitT > 0) { e.hitT -= DT; e.mesh.position.x = e.pos.x + Math.sin(time * 90) * 0.04 * (e.hitT / 0.14) }
      if (moving) {
        e.pos.x = Math.max(-HW + 2, Math.min(HW - 2, e.pos.x + dx / dist * 2.5 * DT)); e.pos.z += dz / dist * 2.5 * DT; e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z)
      }
      if (e.dim === nd() && dist < 45 && (e.fireT -= DT) <= 0) {
        e.fireT = 0.9 + Math.random() * 0.7
        const from = e.turret.getWorldPosition(new V()), to = new V(p.x, p.y + 1.2, p.z)
        beam(from, to, 0.03, 0.12)
        if (Math.random() < 0.55) { st.hp -= 9; st.hurt = 0.35; fx.spark(to, 6, new V(0, 1, 0), ORANGE) }
      }
    }
    best = Math.max(best, Math.floor(-p.z))
    if (st.hp <= 0 || p.y < -30) respawn()
    for (let i = segAt() - 2; i < segAt() + 8; i++) if (i >= 0 && !segs.has(i)) gen(i)
    for (const [i, s] of segs) if (i < segAt() - 2) { disposeSegment(s); segs.delete(i) }
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
    cam.fov += (80 + Math.min(speed, 20) * 0.9 - cam.fov) * Math.min(1, 6 * dt); cam.updateProjectionMatrix()
    if (!dbg.freezeVm) vm.root.position.set(0.15 + st.lookX * 0.4 + Math.cos(st.bob * 0.65) * 0.006, -0.15 + st.lookY * 0.4 + Math.abs(Math.sin(st.bob * 1.3)) * 0.006 - (st.slide ? 0.03 : 0), -0.55 + st.kick * 0.035)
    if (!dbg.freezeVm) vm.root.rotation.set(st.kick * 0.05 + st.lookY * 0.8 + 0.03, 0.3 - st.lookX * 0.8, st.slide ? -0.12 : 0)
    vm.flash.material.opacity = st.flash > 0 ? 0.65 : 0; vm.light.intensity = st.flash > 0 ? 1.2 : 0
    sun.position.set(p.x + SUN.x * 90, p.y + SUN.y * 90, p.z + SUN.z * 90); sun.target.position.copy(p)
    uPlayer.value.copy(p)
    for (const [i, s] of segs) {
      const d0 = Math.abs(i - segAt())
      s.detail.visible = d0 <= 1; s.trees.hi.forEach(o => (o.visible = d0 <= 1)); s.trees.lo.forEach(o => (o.visible = d0 > 1))
    }
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, 1 - Math.abs(d - i) * 1.1), solid = i === nd()
      for (const m of registry[i]) { m.visible = a > 0; m.opacity = solid ? 1 : a * 0.25; m.transparent = !solid; m.depthWrite = solid }
    }
    for (let i = beams.length - 1; i >= 0; i--) if ((beams[i].life -= dt) <= 0) { beams[i].mesh.removeFromParent(); beams.splice(i, 1) }
    boom.intensity = Math.max(0, boom.intensity - dt * 300)
    fx.update(dt, cam.position)
    post.update(SUN, d, time); post.composer.render()

    ctx.clearRect(0, 0, w, h)
    if (st.hurt > 0) { const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.95); g.addColorStop(0, "rgba(180,20,10,0)"); g.addColorStop(1, `rgba(180,20,10,${st.hurt * 0.8})`); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h) }
    ctx.strokeStyle = st.hit > 0 ? "#fff" : "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.5; ctx.shadowColor = "#000"; ctx.shadowBlur = 3
    ctx.beginPath(); ctx.moveTo(w / 2 - 9, h / 2); ctx.lineTo(w / 2 - 4, h / 2); ctx.moveTo(w / 2 + 4, h / 2); ctx.lineTo(w / 2 + 9, h / 2)
    ctx.moveTo(w / 2, h / 2 - 9); ctx.lineTo(w / 2, h / 2 - 4); ctx.moveTo(w / 2, h / 2 + 4); ctx.lineTo(w / 2, h / 2 + 9); ctx.stroke()
    ctx.fillStyle = "#fff"; ctx.font = "14px ui-monospace, monospace"
    ctx.fillText(`${Math.floor(-p.z)} m   ${st.kills} kills   best ${best} m   ${Math.round(speed * 3.6)} km/h`, 20, 30)
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(20, h - 30, 160, 4)
    ctx.fillStyle = "#e8c36a"; ctx.fillRect(20, h - 30, Math.max(0, st.hp) * 1.6, 4)
    for (let i = 0; i < N; i++) { ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(w - 24, h / 2 - 120 + i * 60, 8, 1) }
    ctx.fillStyle = "#fff"; ctx.fillRect(w - 28, h / 2 - 120 + d * 60, 16, 2)
    if (!document.pointerLockElement && !manual && !dbg.hideHint) ctx.fillText("click to play. wasd move, mouse aim, click shoot, wheel phase, space jump, c slide, c+space bullet jump, hold right click glide, wall: run into it", 20, h - 50)
  }

  let raf = 0, last = performance.now(), acc = 0
  let manual = false, scale = 1, ema = 1 / 60, frames = 0
  const tick = (dt: number) => {
    acc += dt
    const dpr = Math.min(2, devicePixelRatio), w = canvas.clientWidth, h = canvas.clientHeight, rp = dpr * scale
    if (canvas.width !== Math.round(w * rp) || canvas.height !== Math.round(h * rp)) {
      renderer.setPixelRatio(rp); renderer.setSize(w, h, false); hud.width = w * dpr; hud.height = h * dpr
      cam.aspect = w / h; cam.updateProjectionMatrix(); post.resize(w, h, rp)
    }
    renderer.shadowMap.needsUpdate = frames++ % 3 === 0
    while (acc > DT) { acc -= DT; step() }
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
  gen(0); gen(1); gen(2)
  raf = requestAnimationFrame(loop)
  ;(window as unknown as { __g: unknown }).__g = { st, segs, genMs, keys, vm, dbg, cam, scene, renderer, post, getScale: () => scale, tick, setDim: (v: number) => (target = v), setManual: (v: boolean) => (manual = v) }

  const kd = (e: KeyboardEvent) => {
    if (e.code === "Space") e.preventDefault()
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
  const wh = (e: WheelEvent) => { e.preventDefault(); target = Math.min(N - 1, Math.max(0, target + e.deltaY * 0.004)) }
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
