"use client"
import { Fragment, useEffect, useRef, useState } from "react"

const fill = { position: "absolute", inset: 0, width: "100vw", height: "100vh", display: "block" } as const
const screen = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" } as const
const link = { background: "none", border: 0, color: "#fff", font: "inherit", fontSize: 22, padding: "6px 0", cursor: "pointer" } as const

type Api = { stop: () => void; begin: () => void; harder: () => void }
type Win = { seconds: number; deaths: number; kills: number; powerups: number; shrines: number; farthest: number }
const clock = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`

export default function Page() {
  const game = useRef<HTMLCanvasElement>(null), hud = useRef<HTMLCanvasElement>(null), api = useRef<Api | null>(null)
  const [load, setLoad] = useState({ frac: 0, label: "starting" }), [ready, setReady] = useState(false), [menu, setMenu] = useState(true), [played, setPlayed] = useState(false), [isPractice, setPractice] = useState(false), [win, setWin] = useState<Win | null>(null)
  useEffect(() => {
    const abort = new AbortController(), q = new URLSearchParams(location.search), demo = q.has("demo"), practice = q.has("practice"); setPractice(practice)
    const stop = import("@/lib/game").then(m => m.startGame(game.current!, hud.current!, abort.signal, (frac, label) => setLoad({ frac, label }), practice)).then(a => { api.current = a; setReady(true); if (demo) { setMenu(false); a.begin() } return a })
    const lock = () => { if (!document.pointerLockElement && !demo) setMenu(true) }
    document.addEventListener("pointerlockchange", lock)
    const won = (e: Event) => setWin((e as CustomEvent<Win>).detail)
    window.addEventListener("phase-victory", won)
    return () => { abort.abort(); window.removeEventListener("phase-victory", won); document.removeEventListener("pointerlockchange", lock); void stop.then(a => a.stop()) }
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
          <button style={{ ...link, marginTop: 36 }} onClick={again}>keep playing, harder</button>
        </div>
      )}
      {ready && menu && !win && (
        <div style={{ ...screen, background: "rgba(8,12,16,0.72)" }}>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3 }}>phase</div>
          <button style={{ ...link, marginTop: 24 }} onClick={start}>{played ? "resume" : isPractice ? "practice" : "play"}</button>
          {!played && <a style={{ ...link, textDecoration: "none" }} href={isPractice ? "./" : "?practice"}>{isPractice ? "real game" : "tutorial"}</a>}
          <div style={{ marginTop: 28, fontSize: 14, opacity: 0.6, textAlign: "center", lineHeight: 1.7 }}>wasd move, space jump, c slide, mouse aim, click fire<br />e and q or the scroll wheel phase between five dimensions, they loop</div>
        </div>
      )}
    </>
  )
}
