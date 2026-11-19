"use client"
import { useEffect, useRef } from "react"
import { startGame } from "@/lib/game"

export default function Page() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => startGame(ref.current!), [])
  return <canvas ref={ref} style={{ width: "100vw", height: "100vh", display: "block" }} />
}
