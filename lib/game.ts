import * as THREE from "three"

const V = THREE.Vector3
type Axis = "x" | "y" | "z"
const N = 5, SEG = 40, HW = 12, DT = 1 / 120, G = 24, SPEED = 10, GOLD = 0xd9a441
type Box = { min: THREE.Vector3; max: THREE.Vector3; dim: number }
type Enemy = { mesh: THREE.Mesh; pos: THREE.Vector3; dim: number; hp: number }
type Seg = { group: THREE.Group; boxes: Box[]; enemies: Enemy[]; clear: number; z0: number }

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

export function startGame(canvas: HTMLCanvasElement, hud: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x07080a)
  scene.fog = new THREE.FogExp2(0x07080a, 0.012)
  const cam = new THREE.PerspectiveCamera(85, 1, 0.05, 300)
  cam.rotation.order = "YXZ"
  scene.add(cam, new THREE.AmbientLight(0xaab4c8, 2.4))
  const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(-3, 10, 4); scene.add(sun)
  const glow = new THREE.PointLight(GOLD, 20, 30); scene.add(glow)

  const per = <T,>(f: () => T) => [...Array(N)].map(f)
  const panel = per(() => new THREE.MeshStandardMaterial({ color: 0x6a7384, metalness: 0.3, roughness: 0.6, transparent: true }))
  const trim = per(() => new THREE.LineBasicMaterial({ color: GOLD, transparent: true }))
  const foe = per(() => new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xffffff, emissiveIntensity: 0.5, transparent: true }))
  const tracerMat = new THREE.LineBasicMaterial({ color: GOLD })

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.35), new THREE.MeshStandardMaterial({ color: 0x15171b }))
  gun.add(new THREE.LineSegments(new THREE.EdgesGeometry(gun.geometry), tracerMat))
  gun.position.set(0.2, -0.18, -0.45); cam.add(gun)

  const segs = new Map<number, Seg>()
  const addBox = (s: Seg, dim: number, a: number[], b: number[], grid = false) => {
    const size = new V(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z)
    const m = new THREE.Mesh(geo, panel[dim])
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), trim[dim]))
    if (grid) {
      const pts: THREE.Vector3[] = [], y = size.y / 2 + 0.01
      for (let x = -size.x / 2; x <= size.x / 2; x += 4) pts.push(new V(x, y, -size.z / 2), new V(x, y, size.z / 2))
      for (let z = -size.z / 2; z <= size.z / 2; z += 4) pts.push(new V(-size.x / 2, y, z), new V(size.x / 2, y, z))
      m.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), trim[dim]))
    }
    s.group.add(m)
    s.boxes.push({ min: new V(...(a as [number, number, number])), max: new V(...(b as [number, number, number])), dim })
  }
  const gen = (i: number) => {
    const r = rng(i * 7919 + 13), z0 = -i * SEG, z1 = z0 - SEG
    const s: Seg = { group: new THREE.Group(), boxes: [], enemies: [], clear: i < 2 ? 2 : Math.floor(r() * N), z0 }
    scene.add(s.group); segs.set(i, s)
    for (let dim = 0; dim < N; dim++) {
      const k = i < 2 || dim === s.clear ? 0.3 : r()
      addBox(s, dim, [-HW - 1, -3, z1], [-HW, 16, z0]); addBox(s, dim, [HW, -3, z1], [HW + 1, 16, z0])
      if (k < 0.2) { addBox(s, dim, [-HW, -3, z0 - 10], [HW, 0, z0], true); addBox(s, dim, [-HW, -3, z1], [HW, 0, z0 - 30], true) }
      else addBox(s, dim, [-HW, -3, z1], [HW, 0, z0], true)
      if (k > 0.6) for (let j = 0; j < 3; j++) {
        const x = -9 + r() * 18, z = z1 + 2 + r() * (SEG - 4), h = 3 + r() * 5
        addBox(s, dim, [x - 1, 0, z - 1], [x + 1, h, z + 1])
      }
      if (r() < 0.6) {
        const x = (r() - 0.5) * 12, y = 3 + r() * 4, z = z1 + 3 + r() * (SEG - 6)
        addBox(s, dim, [x - 3, y, z - 3], [x + 3, y + 0.5, z + 3])
      }
      if (k > 0.35 && k <= 0.6) for (let j = 0; j < 2; j++) {
        const pos = new V((r() - 0.5) * 20, 0, z1 + 4 + r() * (SEG - 8))
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), foe[dim])
        mesh.position.set(pos.x, 0.9, pos.z); s.group.add(mesh)
        s.enemies.push({ mesh, pos, dim, hp: 4 })
      }
    }
  }

  const st = { pos: new V(0, 0.01, -4), vel: new V(), yaw: 0, pitch: 0, ground: false, jumps: 0, slide: false, coyote: 0,
    wallT: 0, wallCD: 0, contact: 0, wn: new V(), hp: 100, kills: 0, fireT: 0, hit: 0, kick: 0, roll: 0, jump: false, fire: false, glide: false }
  let d = 2, target = 2, best = 0
  const keys = new Set<string>()
  const on = (c: string) => keys.has(c)
  const nd = () => Math.round(d)
  const segAt = () => Math.max(0, Math.floor(-st.pos.z / SEG))
  const nearSegs = () => [segAt() - 1, segAt(), segAt() + 1].flatMap(j => segs.get(j) ?? [])
  const nearBoxes = () => nearSegs().flatMap(s => s.boxes).filter(b => b.dim === nd())
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
    if (n) st.vel[axis] = 0
    return n
  }
  const respawn = () => {
    const s = segs.get(segAt())!
    st.pos.set(0, 0.01, s.z0 - 3); st.vel.set(0, 0, 0); st.hp = 100; st.wallT = 0
    d = target = s.clear
  }
  const tracers: { line: THREE.Line; life: number }[] = []
  const shoot = () => {
    const o = cam.getWorldPosition(new V()), dir = cam.getWorldDirection(new V())
    dir.x += (Math.random() - 0.5) * 0.01; dir.y += (Math.random() - 0.5) * 0.01; dir.normalize()
    let tMin = 120, hit: Enemy | null = null
    for (const b of nearBoxes()) tMin = Math.min(tMin, rayBox(o, dir, b.min, b.max))
    for (const s of nearSegs()) for (const e of s.enemies) if (e.dim === nd()) {
      const t = rayBox(o, dir, new V(e.pos.x - 0.4, e.pos.y, e.pos.z - 0.4), new V(e.pos.x + 0.4, e.pos.y + 1.8, e.pos.z + 0.4))
      if (t < tMin) { tMin = t; hit = e }
    }
    if (hit) {
      st.hit = 0.12
      if (--hit.hp <= 0) { hit.mesh.removeFromParent(); st.kills++; for (const s of nearSegs()) s.enemies = s.enemies.filter(e => e !== hit) }
    }
    const muzzle = o.clone().addScaledVector(dir, 0.6).add(new V(0.25, -0.2, 0).applyQuaternion(cam.quaternion))
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([muzzle, o.clone().addScaledVector(dir, tMin)]), tracerMat)
    scene.add(line); tracers.push({ line, life: 0.06 }); st.kick = 0.06
  }

  const step = () => {
    const p = st.pos, v = st.vel, bx = nearBoxes()
    const fwd = new V(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)), right = new V(Math.cos(st.yaw), 0, -Math.sin(st.yaw))
    const wish = new V().addScaledVector(fwd, +on("KeyW") - +on("KeyS")).addScaledVector(right, +on("KeyD") - +on("KeyA"))
    if (wish.lengthSq() > 0) wish.normalize()
    const crouch = on("KeyC") || on("ControlLeft") || on("ShiftLeft")
    d += (target - d) * Math.min(1, 16 * DT)
    for (const b of bx) if (over(b, 1.8)) p.y = b.max.y

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
    const wr = st.wallT > 0
    if (wr) {
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
      if (dist < 35 && dist > 0.9) { e.pos.x = Math.max(-HW + 1, Math.min(HW - 1, e.pos.x + dx / dist * 3.5 * DT)); e.pos.z += dz / dist * 3.5 * DT; e.mesh.position.set(e.pos.x, 0.9, e.pos.z) }
      if (e.dim === nd() && dist < 1.2 && Math.abs(p.y - e.pos.y) < 1.6) st.hp -= 30 * DT
    }
    best = Math.max(best, Math.floor(-p.z))
    if (st.hp <= 0 || p.y < -30) respawn()
    for (let i = segAt() - 2; i < segAt() + 7; i++) if (i >= 0 && !segs.has(i)) gen(i)
    for (const [i, s] of segs) if (i < segAt() - 2) { s.group.removeFromParent(); segs.delete(i) }
  }

  const ctx = hud.getContext("2d")!
  const frame = (w: number, h: number, dt: number) => {
    const p = st.pos, speed = Math.hypot(st.vel.x, st.vel.z), right = new V(Math.cos(st.yaw), 0, -Math.sin(st.yaw))
    st.roll += ((st.wallT > 0 ? -0.14 * st.wn.dot(right) : 0) - st.roll) * Math.min(1, 10 * dt)
    st.kick = Math.max(0, st.kick - dt * 0.5); st.hit = Math.max(0, st.hit - dt)
    cam.position.set(p.x, p.y + (st.slide ? 0.7 : 1.6), p.z)
    cam.rotation.set(st.pitch, st.yaw, st.roll)
    cam.fov += (80 + Math.min(speed, 20) * 0.9 - cam.fov) * Math.min(1, 6 * dt); cam.updateProjectionMatrix()
    gun.position.z = -0.45 + st.kick * 2
    glow.position.set(p.x, p.y + 3, p.z - 2)
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, 1 - Math.abs(d - i) * 1.1), solid = i === nd()
      panel[i].opacity = foe[i].opacity = solid ? 1 : a * 0.22
      panel[i].depthWrite = foe[i].depthWrite = solid
      trim[i].opacity = solid ? 0.9 : a * 0.5
      panel[i].visible = foe[i].visible = trim[i].visible = a > 0
    }
    for (let i = tracers.length - 1; i >= 0; i--) if ((tracers[i].life -= dt) <= 0) { tracers[i].line.removeFromParent(); tracers.splice(i, 1) }
    renderer.render(scene, cam)

    ctx.clearRect(0, 0, w, h)
    const c = st.hit > 0 ? "#fff" : "#d9a441"
    ctx.strokeStyle = c; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(w / 2 - 8, h / 2); ctx.lineTo(w / 2 - 3, h / 2); ctx.moveTo(w / 2 + 3, h / 2); ctx.lineTo(w / 2 + 8, h / 2)
    ctx.moveTo(w / 2, h / 2 - 8); ctx.lineTo(w / 2, h / 2 - 3); ctx.moveTo(w / 2, h / 2 + 3); ctx.lineTo(w / 2, h / 2 + 8); ctx.stroke()
    ctx.fillStyle = "#aaa"; ctx.font = "14px ui-monospace, monospace"
    ctx.fillText(`${Math.floor(-p.z)} m   ${st.kills} kills   best ${best} m   ${Math.round(speed * 3.6)} km/h`, 20, 30)
    ctx.fillStyle = "#d9a441"; ctx.fillRect(20, h - 30, Math.max(0, st.hp) * 1.6, 3)
    for (let i = 0; i < N; i++) { ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(w - 24, h / 2 - 120 + i * 60, 8, 1) }
    ctx.fillStyle = "#fff"; ctx.fillRect(w - 28, h / 2 - 120 + d * 60, 16, 2)
    if (!document.pointerLockElement) ctx.fillText("click to play. wasd move, mouse aim, click shoot, wheel phase, space jump, c slide, c+space bullet jump, hold right click glide, wall: run into it", 20, h - 50)
  }

  let raf = 0, last = performance.now(), acc = 0
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt
    const dpr = Math.min(2, devicePixelRatio), w = canvas.clientWidth, h = canvas.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); hud.width = w * dpr; hud.height = h * dpr
      cam.aspect = w / h; cam.updateProjectionMatrix()
    }
    while (acc > DT) { acc -= DT; step() }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); frame(w, h, dt)
  }
  gen(0); gen(1); gen(2)
  raf = requestAnimationFrame(loop)
  ;(window as unknown as { __g: unknown }).__g = { st, segs }

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
    cancelAnimationFrame(raf); renderer.dispose()
    removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("mousemove", mm)
    removeEventListener("mousedown", md); removeEventListener("mouseup", mu); removeEventListener("contextmenu", noMenu)
    removeEventListener("wheel", wh); canvas.removeEventListener("click", click)
  }
}
