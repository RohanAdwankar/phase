const N = 5, SEG = 480, GROUND = 400, H = 540, DT = 1 / 120
type Box = { x: number; y: number; w: number; h: number }
type Rect = Box & { dim: number }
type Enemy = Rect & { fly: boolean; alive: boolean }

const rng = (s: number) => () => {
  s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function startGame(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!
  let solids: Rect[] = [], enemies: Enemy[] = [], genTo = 0
  let d = 2, target = 2, best = 0, kills = 0, started = false, dead = 0
  const p = { x: 0, y: 0, w: 28, h: 44, vx: 0, vy: 0, ground: false, coyote: 0, wall: 0, slide: false, jumps: 0 }
  const keys = new Set<string>()
  let jumpEdge = false

  const gen = (i: number) => {
    const r = rng(i * 7919 + 13), x = i * SEG
    const clear = i < 3 ? -1 : Math.floor(r() * N)
    for (let dim = 0; dim < N; dim++) {
      const k = i < 3 || dim === clear ? 0 : r()
      if (k < 0.2 && i >= 3) continue
      solids.push({ x, y: GROUND, w: SEG + 1, h: 400, dim })
      if (i < 3) continue
      if (k > 0.85) solids.push({ x: x + 200 + r() * 100, y: GROUND - 90 - r() * 120, w: 40, h: 400, dim })
      else if (k > 0.55) enemies.push({ x: x + 150 + r() * 200, y: GROUND - 36, w: 32, h: 36, dim, fly: false, alive: true })
      else if (k > 0.45) enemies.push({ x: x + 150 + r() * 200, y: GROUND - 74, w: 32, h: 32, dim, fly: true, alive: true })
    }
    if (i >= 3 && r() < 0.5) solids.push({ x: x + r() * 250, y: GROUND - 150 - r() * 80, w: 150, h: 16, dim: Math.floor(r() * N) })
  }
  const reset = () => {
    solids = []; enemies = []; genTo = 0; kills = 0; dead = 0; started = true
    Object.assign(p, { x: 0, y: GROUND - 44, vx: 300, vy: 0, h: 44, slide: false, jumps: 0 })
  }
  reset(); started = false

  const nd = () => Math.round(d)
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  const near = () => solids.filter(s => s.dim === nd() && s.x < p.x + 200 && s.x + s.w > p.x - 200)

  const step = () => {
    const key = (k: string) => keys.has(k)
    const wantSlide = key("s") || key("control") || key("arrowdown")
    const jumpHeld = key(" ") || key("w") || key("arrowup")
    const base = 340 + Math.min(p.x / 40, 380)
    d += (target - d) * Math.min(1, 16 * DT)

    for (const s of near()) if (hit(p, s) && p.y + p.h - s.y < 60) p.y = s.y - p.h

    const wasSlide = p.slide
    p.slide = wantSlide && p.ground
    if (p.slide !== wasSlide) {
      const bottom = p.y + p.h
      p.h = p.slide ? 22 : 44
      p.y = bottom - p.h
      if (p.slide) p.vx = Math.max(p.vx, base * 1.5)
    }
    const rate = p.slide ? 500 : 2500
    p.vx += Math.sign(base - p.vx) * Math.min(Math.abs(base - p.vx), rate * DT)

    p.coyote = p.ground ? 0.1 : p.coyote - DT
    p.wall -= DT
    if (jumpEdge) {
      if (p.coyote > 0) { p.vy = -700; p.coyote = 0; p.jumps = 1 }
      else if (p.wall > 0) { p.vy = -720; p.jumps = 1 }
      else if (p.jumps < 2) { p.vy = -640; p.jumps = 2 }
      jumpEdge = false
    }
    if (!jumpHeld && p.vy < -300 && p.wall <= 0) p.vy *= 0.92
    if (!p.ground && wantSlide) p.vy = Math.max(p.vy, 900)
    if (p.wall > 0) p.vy = jumpHeld ? Math.min(p.vy, -320) : Math.min(p.vy, 140)
    p.vy += 1800 * DT

    p.x += p.vx * DT
    for (const s of near()) if (hit(p, s)) {
      p.x = s.x - p.w; p.vx = 0
      if (!p.ground || jumpHeld) p.wall = 0.12
      if (!p.ground && jumpHeld) p.jumps = 1
    }
    p.y += p.vy * DT
    p.ground = false
    for (const s of near()) if (hit(p, s)) {
      if (p.vy > 0) { p.y = s.y - p.h; p.ground = true; p.jumps = 0 } else p.y = s.y + s.h
      p.vy = 0
    }
    if (p.ground) p.wall = 0

    for (const e of enemies) {
      if (!e.alive || e.dim !== nd() || !hit(p, e)) continue
      if (p.slide || (p.vy > 200 && p.y + p.h - e.y < 24)) { e.alive = false; kills++; p.vx += 120; if (p.vy > 0) p.vy = -450 }
      else dead = 0.6
    }
    if (p.y > H + 200) dead = 0.6
    best = Math.max(best, Math.floor(p.x / 20))
    while (genTo * SEG < p.x + 2400) gen(genTo++)
    solids = solids.filter(s => s.x + s.w > p.x - 800)
    enemies = enemies.filter(e => e.x > p.x - 800)
  }

  const draw = (w: number, h: number) => {
    const sc = h / H, camX = p.x - 280
    ctx.setTransform(sc, 0, 0, sc, 0, 0)
    ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, w / sc, H)
    const alpha = (dim: number) => Math.max(0, 1 - Math.abs(d - dim) * 1.1)
    const off = (dim: number) => (dim === nd() ? 0 : (dim - d) * 36)
    const order = [...Array(N).keys()].sort((a, b) => Math.abs(b - d) - Math.abs(a - d))
    for (const dim of order) {
      const a = alpha(dim), solid = dim === nd(), o = off(dim)
      if (a <= 0) continue
      ctx.fillStyle = `rgba(235,235,235,${solid ? 0.25 + 0.75 * a : a * 0.28})`
      for (const s of solids) if (s.dim === dim && s.x - camX < w / sc && s.x + s.w - camX > 0) ctx.fillRect(s.x - camX + o, s.y, s.w, s.h)
      ctx.fillStyle = `rgba(235,235,235,${solid ? 1 : a * 0.5})`
      for (const e of enemies) if (e.dim === dim && e.alive) {
        const cx = e.x + e.w / 2 - camX + o, cy = e.y + e.h / 2
        ctx.beginPath(); ctx.moveTo(cx, e.y); ctx.lineTo(cx + e.w / 2, cy); ctx.lineTo(cx, e.y + e.h); ctx.lineTo(cx - e.w / 2, cy); ctx.fill()
      }
    }
    ctx.fillStyle = dead ? "#777" : "#fff"
    ctx.fillRect(p.x - camX, p.y, p.w, p.h)
    ctx.fillStyle = "rgba(255,255,255,0.12)"
    for (let i = 0; i < 14; i++) {
      const lx = ((i * 197 - camX * 1.6) % (w / sc + 200) + w / sc + 200) % (w / sc + 200) - 100
      ctx.fillRect(lx, (i * 83) % H, 40 + p.vx / 12, 1)
    }
    for (let i = 0; i < N; i++) { ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(w / sc - 24, 150 + i * 60, 8, 1) }
    ctx.fillStyle = "#fff"; ctx.fillRect(w / sc - 28, 150 + d * 60, 16, 2)
    ctx.fillStyle = "#aaa"; ctx.font = "14px ui-monospace, monospace"
    ctx.fillText(`${Math.floor(p.x / 20)} m   ${kills} kills   best ${best} m`, 20, 30)
    if (!started) ctx.fillText("scroll to phase, space to jump and climb, s to slide. press any key", 20, H - 24)
  }

  let raf = 0, last = performance.now(), acc = 0
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    acc += Math.min(0.1, (now - last) / 1000); last = now
    const dpr = devicePixelRatio, w = canvas.clientWidth, h = canvas.clientHeight
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr }
    while (acc > DT) {
      acc -= DT
      if (!started) continue
      if (dead) { dead -= DT; if (dead <= 0) reset(); continue }
      step()
    }
    ctx.save(); ctx.scale(dpr, dpr); draw(w, h); ctx.restore()
  }
  raf = requestAnimationFrame(loop)

  const kd = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (k === " " || k.startsWith("arrow")) e.preventDefault()
    if (!started) { started = true }
    if (k === "q") target = Math.max(0, Math.round(target) - 1)
    if (k === "e") target = Math.min(N - 1, Math.round(target) + 1)
    if (!e.repeat && (k === " " || k === "w" || k === "arrowup")) jumpEdge = true
    keys.add(k)
  }
  const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
  const wh = (e: WheelEvent) => {
    e.preventDefault(); started = true
    target = Math.min(N - 1, Math.max(0, target + e.deltaY * 0.004))
  }
  addEventListener("keydown", kd); addEventListener("keyup", ku)
  canvas.addEventListener("wheel", wh, { passive: false })
  return () => { cancelAnimationFrame(raf); removeEventListener("keydown", kd); removeEventListener("keyup", ku); canvas.removeEventListener("wheel", wh) }
}
