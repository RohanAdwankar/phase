// Reports how many enemies the world spawns per minute of running (10 m/s over fresh ground) at several guardian counts.
// Usage: node tests/spawn-curve.mjs http://localhost:3000/ (needs playwright)
import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"] })
const pg = await b.newPage({ viewport: { width: 640, height: 360 } }); pg.setDefaultTimeout(3000000)
await pg.goto((process.argv[2] ?? "http://localhost:3000/") + "?demo"); await pg.waitForFunction("window.__g?.chunks.size >= 25")
const rows = await pg.evaluate(() => {
  const g = window.__g, st = g.st, rows = []; g.setManual(true); g.sfx.play = () => {}; st.inv = 999; st.maxHp = 1e9; st.hp = 1e9
  const set = g.chunks.set.bind(g.chunks); let made = 0, mine = 0, builds = 0
  g.chunks.set = (k, c) => { builds++; made += c.enemies.length; mine += c.enemies.filter(e => e.dim === g.getNd()).length; return set(k, c) }
  let i0 = 0
  for (const cleared of [0, 5, 10, 20]) {
    st.cleared = cleared; st.level = 0; made = mine = builds = 0
    st.pos.set(20000 * ++i0, 40, 0); for (let i = 0; i < 90; i++) g.tick(1 / 30)  // let the start area settle
    made = mine = builds = 0
    const t0 = performance.now(); let calls = 0
    for (let i = 0; i < 30 * 60; i++) { st.pos.x += 0.333; st.vel.set(0, 0, 0); g.tick(1 / 30); calls = Math.max(calls, g.renderer.info.render.calls) }
    let loaded = 0; for (const c of g.chunks.values()) loaded += c.enemies.length
    rows.push({ cleared, density: +g.density().toFixed(2), chunksBuilt: builds, spawnedPerMinute: made, inYourDimension: mine, loaded, tickMs: +((performance.now() - t0) / 1800).toFixed(1), calls })
  }
  return rows
})
await b.close()
const base = rows[0].spawnedPerMinute
for (const r of rows) console.log(`${String(r.cleared).padStart(2)} guardians cleared: density ${r.density}, ${r.chunksBuilt} chunks built, ${r.spawnedPerMinute} enemies spawned per minute of running (${r.inYourDimension} in your dimension), ratio ${(r.spawnedPerMinute / base).toFixed(2)}x; ${r.loaded} loaded at the end, ${r.tickMs} ms per tick, up to ${r.calls} draw calls`)
