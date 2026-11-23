// Fire patches burn what stands on the ground and nothing that flies. Usage: node tests/fire-ground-only.mjs http://localhost:3000/ (needs playwright)
import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"] })
const pg = await b.newPage({ viewport: { width: 640, height: 360 } }); pg.setDefaultTimeout(600000)
await pg.goto((process.argv[2] ?? "http://localhost:3000/") + "?demo"); await pg.waitForFunction("window.__g?.chunks.size >= 25")
const r = await pg.evaluate(() => {
  const g = window.__g, st = g.st; g.setManual(true); g.sfx.play = () => {}; st.inv = 999
  for (let i = 0; i < 120; i++) g.tick(1 / 30)
  const mk = kind => { g.summon(kind, 1, 30, 30, g.getNd(), 0, 6.28); let best = null; for (const c of g.chunks.values()) for (const e of c.enemies) if (e.kind === kind && e.dim === g.getNd() && (!best || Math.hypot(e.pos.x - st.pos.x, e.pos.z - st.pos.z) < Math.hypot(best.pos.x - st.pos.x, best.pos.z - st.pos.z))) best = e; best.speed = 0; best.hp = best.maxHp = 1e6; return best }
  const walker = mk("walker"), flyer = mk("flyer"), V = st.pos.constructor
  for (const e of [walker, flyer]) { e.pos.x = walker.pos.x; e.pos.z = walker.pos.z }
  for (const c of g.chunks.values()) c.enemies = c.enemies.filter(e => { if (e === walker || e === flyer) return true; e.mesh.removeFromParent(); return false }) // nothing else may hurt them
  g.tick(1 / 30)
  const h0 = [walker.hp, flyer.hp], flyerAbove = flyer.pos.y - g.groundH(flyer.pos.x, flyer.pos.z)
  g.spawnFire(new V(walker.pos.x, 0, walker.pos.z), g.getNd())
  for (let i = 0; i < 90; i++) { for (const e of [walker, flyer]) { e.pos.x = walker.pos.x; e.pos.z = walker.pos.z } g.tick(1 / 30) }
  return { flyerAbove: +flyerAbove.toFixed(1), walker: h0[0] - walker.hp, flyer: h0[1] - flyer.hp }
})
await b.close()
console.log(JSON.stringify(r))
if (!(r.walker > 0 && r.flyer === 0)) { console.error("expected the walker to burn and the drone not to"); process.exit(1) }
