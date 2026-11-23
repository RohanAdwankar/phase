// Whatever kills the warden (or a guardian) in the middle of a frame, it must stay dead through the victory screen and "next level".
// Usage: node tests/warden-stays-dead.mjs http://localhost:3000/ (needs playwright)
import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"] })
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }); pg.setDefaultTimeout(900000)
await pg.goto(process.argv[2] ?? "http://localhost:3000/"); await pg.waitForFunction("window.__g?.chunks.size >= 25")
await pg.getByText("play", { exact: true }).click(); await pg.waitForTimeout(1200)
const count = kind => pg.evaluate(kind => { const g = window.__g; let n = 0; for (const c of g.chunks.values()) for (const e of c.enemies) if (e.kind === kind) n++; return n }, "boss")
await pg.evaluate(() => {
  const g = window.__g, st = g.st; st.inv = 999; st.maxHp = 1e9; st.hp = 1e9; g.sfx.play = () => {}; g.setManual(true)
  const sh = g.getShrine(1, 0); st.pos.set(sh.cx, 40, sh.cz); for (let i = 0; i < 150; i++) g.tick(1 / 30)
  g.startBoss(sh); for (let i = 0; i < 10; i++) g.tick(1 / 30)
  const w = sh.boss
  // a neighbour that is processed before the warden and kills it during its own update, as a blast or fire would
  g.summon("swarmer", 1, 3, 3, g.getNd(), 0, 6.28, w.pos); let k = null
  for (const c of g.chunks.values()) for (const e of c.enemies) if (e.kind === "swarmer" && e.dim === g.getNd() && Math.hypot(e.pos.x - w.pos.x, e.pos.z - w.pos.z) < 6) k = k ?? e
  const cw = [...g.chunks.values()].find(c => c.enemies.includes(w)), ck = [...g.chunks.values()].find(c => c.enemies.includes(k))
  ck.enemies = ck.enemies.filter(e => e !== k); cw.enemies = [k, ...cw.enemies.filter(e => e !== k)]; cw.group.add(k.mesh); k.pos.set(w.pos.x + 3, w.pos.y, w.pos.z)
  let fired = false; const upd = k.update; k.update = (...a) => { if (!fired) { fired = true; g.killWalker(w) } return upd(...a) }
  for (let i = 0; i < 6; i++) g.tick(1 / 30)
  g.setManual(false)
})
const afterKill = await count("boss")
await pg.waitForTimeout(800)
const victory = await pg.getByText("victory").isVisible()
if (victory) await pg.getByText("next level").click(); await pg.waitForTimeout(500)
await pg.evaluate(() => { window.__g.setManual(true); for (let i = 0; i < 120; i++) window.__g.tick(1 / 30) })
const afterNext = await count("boss")
await b.close()
console.log(JSON.stringify({ victory, wardensAfterKill: afterKill, wardensAfterNextLevel: afterNext }))
if (!victory || afterKill !== 0 || afterNext !== 0) { console.error("a warden outlived its death"); process.exit(1) }
console.log("the warden stays dead")
