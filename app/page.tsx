"use client"
import { useEffect, useRef } from "react"

const fill = { position: "absolute", inset: 0, width: "100vw", height: "100vh", display: "block" } as const

export default function Page() {
  const game = useRef<HTMLCanvasElement>(null), hud = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const abort = new AbortController()
    const stop = import("@/lib/game").then(m => m.startGame(game.current!, hud.current!, abort.signal))
    return () => { abort.abort(); void stop.then(f => f()) }
  }, [])
  return (
    <>
      <canvas ref={game} style={fill} />
      <canvas ref={hud} style={{ ...fill, pointerEvents: "none" }} />
    </>
  )
}
