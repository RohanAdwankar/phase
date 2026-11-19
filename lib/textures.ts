import * as THREE from "three"
import { tileFbm } from "./noise"

const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)))

const paint = (size: number, color: (u: number, v: number) => number[]) => {
  const c = document.createElement("canvas"); c.width = c.height = size
  const g = c.getContext("2d")!, img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, gr, b] = color(x / size, y / size), i = (y * size + x) * 4
    img.data.set([r, gr, b, 255], i)
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  return t
}

export const groundTexture = () => paint(512, (u, v) => {
  const big = tileFbm(u, v, 3, 4), fine = tileFbm(u, v, 40, 2, 7), dirt = tileFbm(u, v, 5, 3, 3)
  let c = mix([52, 88, 30], [118, 150, 58], big * 1.6 - 0.2)
  c = mix(c, [120, 96, 62], (dirt - 0.55) * 5)
  const k = 0.8 + fine * 0.5
  return c.map(x => x * k)
})

export const rockTexture = () => paint(512, (u, v) => {
  const big = tileFbm(u, v, 4, 5, 11), strata = Math.sin(v * Math.PI * 2 * 9 + big * 9) * 0.5 + 0.5
  const crack = 1 - 0.22 * Math.max(0, 1 - Math.abs(tileFbm(u, v, 9, 3, 5) - 0.45) / 0.03)
  let c = mix([96, 88, 78], [176, 164, 144], big * 1.5 + strata * 0.3 - 0.3)
  c = mix(c, [96, 100, 70], (tileFbm(u, v, 6, 3, 9) - 0.5) * 2.5)
  return c.map(x => x * crack)
})

export const flashTexture = () => {
  const c = document.createElement("canvas"); c.width = c.height = 128
  const g = c.getContext("2d")!
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.2, "rgba(255,200,110,0.9)"); r.addColorStop(1, "rgba(255,90,20,0)")
  g.fillStyle = r; g.fillRect(0, 0, 128, 128)
  g.fillStyle = "rgba(255,210,140,0.9)"
  for (const [w, h] of [[120, 7], [7, 120], [60, 4], [4, 60]]) { g.save(); g.translate(64, 64); if (w === 60 || h === 60) g.rotate(Math.PI / 4); g.fillRect(-w / 2, -h / 2, w, h); g.restore() }
  return new THREE.CanvasTexture(c)
}
