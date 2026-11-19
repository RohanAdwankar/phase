const hash = (x: number, y: number, z: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return n - Math.floor(n)
}
const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const noise = (x: number, y: number, z = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi)
  const plane = (zz: number) => lerp(lerp(hash(xi, yi, zz), hash(xi + 1, yi, zz), u), lerp(hash(xi, yi + 1, zz), hash(xi + 1, yi + 1, zz), u), v)
  return lerp(plane(zi), plane(zi + 1), w)
}

export const fbm = (x: number, y: number, z = 0, octaves = 4) => {
  let sum = 0, amp = 0.5, f = 1
  for (let i = 0; i < octaves; i++) { sum += amp * noise(x * f, y * f, z * f); f *= 2; amp *= 0.5 }
  return sum
}

// fbm that tiles with period 1 in u and v, for seamless textures
export const tileFbm = (u: number, v: number, freq: number, octaves = 4, seed = 0) => {
  const s = (a: number, b: number) => fbm(a * freq, b * freq, seed, octaves)
  return s(u, v) * (1 - u) * (1 - v) + s(u - 1, v) * u * (1 - v) + s(u, v - 1) * (1 - u) * v + s(u - 1, v - 1) * u * v
}
