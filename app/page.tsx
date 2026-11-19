"use client"
import { useEffect, useRef } from "react"
import { startGame } from "@/lib/game"

const fill = { position: "absolute", inset: 0, width: "100vw", height: "100vh", display: "block" } as const

export default function Page() {
  const game = useRef<HTMLCanvasElement>(null), hud = useRef<HTMLCanvasElement>(null)
  useEffect(() => startGame(game.current!, hud.current!), [])
  return (
    <>
      <canvas ref={game} style={fill} />
      <canvas ref={hud} style={{ ...fill, pointerEvents: "none" }} />
    </>
  )
}
