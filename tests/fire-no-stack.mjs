// Fire does not stack: any number of overlapping patches burn a target exactly like one, and separate patches still burn it in turn.
// Usage: node tests/fire-no-stack.mjs http://localhost:3000/ (needs playwright)
import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"] })
const pg = await b.newPage({ viewport: { width: 640, height: 360 } }); pg.setDefaultTimeout(900000)
await pg.goto((process.argv[2] ?? "http://localhost:3000/") + "?demo"); await pg.waitForFunction("window.__g?.chunks.size >= 25")
const r = await pg.evaluate(() => {
  const g = window.__g, st = g.st, V = st.pos.constructor; g.setManual(true); g.sfx.play = () => {}
  for (let i = 0; i < 120; i++) g.tick(1 / 30)
  const walker = () => { g.summon("walker", 1, 30, 30, g.getNd(), 0, 6.28); let best = null; for (const c of g.chunks.values()) for (const e of c.enemies) if (e.kind === "walker" && e.dim === g.getNd() && (!best || Math.hypot(e.pos.x - st.pos.x, e.pos.z - st.pos.z) < Math.hypot(best.pos.x - st.pos.x, best.pos.z - st.pos.z))) best = e; best.speed = 0; best.fireT = 1e9; best.hp = best.maxHp = 1e6; return best }
  const clear = keep => { for (const c of g.chunks.values()) c.enemies = c.enemies.filter(e => { if (keep.includes(e)) return true; e.mesh.removeFromParent(); return false }) }
  const run = (patches, secs, move) => {
    for (let i = 0; i < 160; i++) g.tick(1 / 30) // let earlier patches burn out
    const w = walker(); clear([w]); st.inv = 0; st.maxHp = 1e9; st.hp = 1e9; g.tick(1 / 30)
    const homeX = w.pos.x, homeZ = w.pos.z; st.pos.set(homeX + 0.5, g.groundH(homeX, homeZ) + 0.05, homeZ); st.vel.set(0, 0, 0)
    for (const [dx, dz] of patches) g.spawnFire(new V(homeX + dx, 0, homeZ + dz), g.getNd())
    const hp0 = w.hp, ph0 = st.hp
    for (let i = 0; i < 30 * secs; i++) { if (move) { const at = move(i / 30); w.pos.x = homeX + at; st.pos.x = homeX + at + 0.5 } st.vel.set(0, 0, 0); g.tick(1 / 30) }
    return { enemy: +(hp0 - w.hp).toFixed(2), player: +(ph0 - st.hp).toFixed(2) }
  }
  const out = {}
  out.one = run([[0, 0]], 3)
  out.two = run([[0, 0], [1.5, 0.5]], 3)
  out.five = run([[0, 0], [1, 1], [-1, 1], [1, -1], [-1.5, -0.5]], 3)
  // two patches 30 m apart, the target hops from the first to the second after 1.5 s: burned in both, same total as standing in one for 3 s
  out.hop = run([[0, 0], [30, 0]], 3, t => (t < 1.5 ? 0 : 30))
  return out
})
await b.close()
console.log(JSON.stringify(r))
const same = (a, b) => a.enemy === b.enemy && a.player === b.player
if (!(r.one.enemy > 0 && r.one.player > 0 && same(r.one, r.two) && same(r.one, r.five))) { console.error("overlapping patches stacked or did not burn"); process.exit(1) }
if (!(Math.abs(r.hop.enemy - r.one.enemy) <= 3.01 && Math.abs(r.hop.player - r.one.player) <= 2.51)) { console.error("a target moving between separate patches was not burned like in one"); process.exit(1) }
console.log("fire does not stack")
