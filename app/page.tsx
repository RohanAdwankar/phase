"use client"
import { useEffect, useRef, useState } from "react"

const fill = { position: "absolute", inset: 0, width: "100vw", height: "100vh", display: "block" } as const
const screen = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" } as const
const link = { background: "none", border: 0, color: "#fff", font: "inherit", fontSize: 22, padding: "6px 0", cursor: "pointer" } as const

type Api = { stop: () => void; tutorial: () => void }

export default function Page() {
  const game = useRef<HTMLCanvasElement>(null), hud = useRef<HTMLCanvasElement>(null), api = useRef<Api | null>(null)
  const [load, setLoad] = useState({ frac: 0, label: "starting" }), [ready, setReady] = useState(false), [menu, setMenu] = useState(true), [played, setPlayed] = useState(false)
  useEffect(() => {
    const abort = new AbortController(), demo = new URLSearchParams(location.search).has("demo")
    const stop = import("@/lib/game").then(m => m.startGame(game.current!, hud.current!, abort.signal, (frac, label) => setLoad({ frac, label }))).then(a => { api.current = a; setReady(true); if (demo) setMenu(false); return a })
    const lock = () => { if (!document.pointerLockElement && !demo) setMenu(true) }
    document.addEventListener("pointerlockchange", lock)
    return () => { abort.abort(); document.removeEventListener("pointerlockchange", lock); void stop.then(a => a.stop()) }
  }, [])
  const start = (tutorial: boolean) => { if (tutorial) api.current?.tutorial(); setPlayed(true); setMenu(false); game.current?.click() }
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
      {ready && menu && (
        <div style={{ ...screen, background: "rgba(8,12,16,0.72)" }}>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3 }}>phase</div>
          <button style={{ ...link, marginTop: 24 }} onClick={() => start(false)}>{played ? "resume" : "play"}</button>
          <button style={link} onClick={() => start(true)}>tutorial</button>
          <div style={{ marginTop: 28, fontSize: 14, opacity: 0.6, textAlign: "center", lineHeight: 1.7 }}>wasd move, space jump, c slide, mouse aim, click fire<br />e and q or the scroll wheel phase between five dimensions, they loop</div>
        </div>
      )}
    </>
  )
}
