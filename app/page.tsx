"use client"
import { Fragment, useEffect, useRef, useState } from "react"

const fill = { position: "absolute", inset: 0, width: "100vw", height: "100vh", display: "block" } as const
const screen = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" } as const
const KEYS: [string[], string][] = [[["w", "a", "s", "d"], "move"], [["space"], "jump, again in the air to double jump"], [["c", "shift"], "slide"], [["e", "q"], "phase to the next or previous dimension"], [["1", "2", "3"], "pistol, bow, sword"], [["g"], "grenade, or plant tnt with the bow"], [["r"], "reload"], [["esc"], "pause"]]
const MOUSE: [string, string][] = [["click", "fire, hold to draw the bow or charge the sword"], ["scroll", "phase, a little peeks, a lot switches"], ["move", "aim"]]
const TREE: [string, [string, string][]][] = [
  ["pistol", [["double mag", "24 rounds instead of 12"], ["berserker", "at 20% health or less, damage and mag size double again"]]],
  ["bow", [["piercing", "arrows fly through every enemy in line"], ["fire", "arrows leave a burning patch where they land"]]],
  ["sword", [["parry", "a swing in the air turns enemy shots back on them"], ["no cooldown", "short swings are twice as fast and chain freely"]]],
]
const GOALS = [["giants", 20], ["spiders", 50], ["drones and bomb guys", 100]] as const
const cap = { background: "rgba(255,255,255,0.14)", padding: "3px 9px", marginRight: 5, fontFamily: "ui-monospace, monospace", fontSize: 14 } as const
const link = { background: "none", border: 0, color: "#fff", font: "inherit", fontSize: 22, padding: "6px 0", cursor: "pointer" } as const

type Api = { stop: () => void; begin: () => void; harder: () => void; buy: (i: number) => void }
type Skills = { points: number; levels: number[]; progress: number[] }
type Win = { seconds: number; deaths: number; kills: number; powerups: number; shrines: number; farthest: number }
const clock = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`

export default function Page() {
  const game = useRef<HTMLCanvasElement>(null), hud = useRef<HTMLCanvasElement>(null), api = useRef<Api | null>(null)
  const [load, setLoad] = useState({ frac: 0, label: "starting" }), [ready, setReady] = useState(false), [menu, setMenu] = useState(true), [played, setPlayed] = useState(false), [isPractice, setPractice] = useState(false), [win, setWin] = useState<Win | null>(null), [sk, setSk] = useState<Skills>({ points: 0, levels: [0, 0, 0], progress: [0, 0, 0] })
  useEffect(() => {
    const abort = new AbortController(), q = new URLSearchParams(location.search), demo = q.has("demo"), practice = q.has("practice"); setPractice(practice)
    const stop = import("@/lib/game").then(m => m.startGame(game.current!, hud.current!, abort.signal, (frac, label) => setLoad({ frac, label }), practice)).then(a => { api.current = a; setReady(true); if (demo) { setMenu(false); a.begin() } return a })
    const lock = () => { if (!document.pointerLockElement && !demo) setMenu(true) }
    document.addEventListener("pointerlockchange", lock)
    const won = (e: Event) => setWin((e as CustomEvent<Win>).detail)
    window.addEventListener("phase-victory", won)
    const skills = (e: Event) => setSk((e as CustomEvent<Skills>).detail)
    window.addEventListener("phase-skills", skills)
    return () => { abort.abort(); window.removeEventListener("phase-victory", won); window.removeEventListener("phase-skills", skills); document.removeEventListener("pointerlockchange", lock); void stop.then(a => a.stop()) }
  }, [])
  const again = () => { api.current?.harder(); setWin(null); setMenu(false); game.current?.click() }
  const start = () => { api.current?.begin(); setPlayed(true); setMenu(false); game.current?.click() }
  return (
    <>
      <canvas ref={game} style={fill} />
      <canvas ref={hud} style={{ ...fill, pointerEvents: "none" }} />
      {!ready && (
        <div style={{ ...screen, background: "#0b1218" }}>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3 }}>phase</div>
          <div style={{ width: 240, height: 2, background: "rgba(255,255,255,0.15)", marginTop: 28 }}><div style={{ width: `${load.frac * 100}%`, height: 2, background: "#fff", transition: "width 0.2s" }} /></div>
          <div style={{ marginTop: 14, fontSize: 14, opacity: 0.6 }}>{load.label}</div>
        </div>
      )}
      {win && (
        <div style={{ ...screen, background: "rgba(8,12,16,0.82)" }}>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3 }}>victory</div>
          <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "auto auto", gap: "6px 36px", fontSize: 20 }}>
            {([["time", clock(win.seconds)], ["deaths", win.deaths], ["kills", win.kills], ["powerups", win.powerups], ["shrines cleared", win.shrines], ["farthest from start", `${win.farthest} m`]] as const).map(([k, v]) => <Fragment key={k}><span style={{ opacity: 0.6 }}>{k}</span><span style={{ textAlign: "right" }}>{v}</span></Fragment>)}
          </div>
          <button style={{ ...link, marginTop: 36 }} onClick={again}>next level</button>
        </div>
      )}
      {ready && menu && !win && (
        <div style={{ ...screen, background: "rgba(8,12,16,0.72)" }}>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3 }}>phase</div>
          <button style={{ ...link, marginTop: 24 }} onClick={start}>{played ? "resume" : isPractice ? "practice" : "play"}</button>
          {!played && <a style={{ ...link, textDecoration: "none" }} href={isPractice ? "./" : "?practice"}>{isPractice ? "real game" : "tutorial"}</a>}
          {played && !isPractice && (
            <div style={{ marginTop: 28, fontSize: 14, textAlign: "center" }}>
              <div style={{ opacity: 0.7 }}>{sk.points} skill {sk.points === 1 ? "point" : "points"} · {GOALS.map(([n, g], i) => `${n} ${sk.progress[i]}/${g}`).join(" · ")}</div>
              <div style={{ display: "flex", gap: 36, marginTop: 14 }}>
                {TREE.map(([w, nodes], i) => (
                  <div key={w} style={{ display: "flex", flexDirection: "column", gap: 8, width: 190 }}>
                    <div style={{ opacity: 0.5 }}>{w}</div>
                    {nodes.map(([name, text], t) => {
                      const owned = sk.levels[i] > t, open = sk.levels[i] === t && sk.points > 0
                      return <button key={name} disabled={!open} onClick={() => api.current?.buy(i)} style={{ background: owned ? "#fff" : "rgba(255,255,255,0.12)", color: owned ? "#0b1218" : "#fff", opacity: owned || open ? 1 : 0.4, border: 0, padding: "9px 10px", font: "inherit", cursor: open ? "pointer" : "default", textAlign: "left" }}><div style={{ fontWeight: 700 }}>{name}</div><div style={{ fontSize: 12, marginTop: 3 }}>{text}</div></button>
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "auto auto", gap: "9px 26px", fontSize: 14, alignItems: "center" }}>
            {MOUSE.map(([k, v]) => <Fragment key={k}><span><span style={cap}>mouse {k}</span></span><span style={{ opacity: 0.7 }}>{v}</span></Fragment>)}
            {KEYS.map(([ks, v]) => <Fragment key={v}><span>{ks.map(k => <span key={k} style={cap}>{k}</span>)}</span><span style={{ opacity: 0.7 }}>{v}</span></Fragment>)}
          </div>
        </div>
      )}
    </>
  )
}
