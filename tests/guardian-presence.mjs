// A guardian registered on a pylon must be in the live scene whenever you stand at that pylon, even when you
// arrive on foot after its chunk was unloaded. Usage: node tests/guardian-presence.mjs http://localhost:3000/ (needs playwright)
import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"] })
const pg = await b.newPage({ viewport: { width: 640, height: 360 } }); pg.setDefaultTimeout(1500000)
await pg.goto((process.argv[2] ?? "http://localhost:3000/") + "?demo"); await pg.waitForFunction("window.__g?.chunks.size >= 25")
const bad = await pg.evaluate(() => {
  const g = window.__g, st = g.st, bad = []; g.setManual(true); st.inv = 999; st.maxHp = 1e6; st.hp = 1e6; g.sfx.play = () => {}
  const root = o => { while (o.parent) o = o.parent; return o }, settle = n => { for (let i = 0; i < n; i++) g.tick(1 / 30) }
  const live = e => !!e && root(e.mesh) === g.scene && [...g.chunks.values()].some(c => c.enemies.includes(e))
  for (const sx of [1, 2]) {
    const sh = g.getShrine(sx, 0); st.pos.set(sh.cx, 40, sh.cz); settle(150)
    for (const py of sh.pylons) {
      const ux = Math.cos(py.i * 1.3 + sx), uz = Math.sin(py.i * 1.3 + sx)
      st.pos.set(py.x + ux * 220, 40, py.z + uz * 220); g.setDim(py.dim); settle(40)
      while (Math.hypot(py.x - st.pos.x, py.z - st.pos.z) > 25) { st.pos.x -= ux * 0.6; st.pos.z -= uz * 0.6; st.vel.set(0, 0, 0); g.tick(1 / 30) }
      settle(60); if (!live(py.guard)) bad.push(`shrine ${sx} pylon ${py.i}: ${py.guard ? "registered but not in the scene" : "no guardian"}`)
    }
  }
  return bad
})
await b.close()
if (bad.length) { console.error(bad.join("\n")); process.exit(1) }
console.log("every guardian was present on arrival")
