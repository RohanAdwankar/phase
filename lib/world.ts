import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { fbm } from "./noise"
import { groundTexture, rockTexture } from "./textures"
import { N, FoeMats, Enemy, Mat, makeFoeMats, walker } from "./actors"

const V = THREE.Vector3
export const SEG = 40, HW = 16
export type Box = { min: THREE.Vector3; max: THREE.Vector3; dim: number }
export type Seg = { group: THREE.Group; boxes: Box[]; enemies: Enemy[]; clear: number; z0: number }
export const uTime = { value: 0 }

const per = <T,>(f: (i: number) => T) => [...Array(N)].map((_, i) => f(i))
const TINT = [0xb4d978, 0xdcc56a, 0x78c9b4, 0xd98f5a, 0xb09ae0]

export const makeMats = () => {
  const ground = groundTexture(), rock = rockTexture()
  const grassMat = (i: number) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, transparent: true, color: TINT[i] })
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = uTime
      sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3]); float k = pow(position.y * 2.0, 2.0);
        transformed.x += sin(uTime * 1.7 + ip.x * 0.35 + ip.z * 0.27) * 0.14 * k;
        transformed.z += cos(uTime * 1.3 + ip.z * 0.4) * 0.08 * k;`)
    }
    return m
  }
  return {
    rock: per(() => new THREE.MeshStandardMaterial({ map: rock, roughness: 0.92, metalness: 0, transparent: true })),
    ground: per(i => new THREE.MeshStandardMaterial({ map: ground, color: TINT[i], roughness: 0.95, transparent: true })),
    grass: per(grassMat),
    foe: makeFoeMats(),
    hill: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    tree: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  }
}
export type Mats = ReturnType<typeof makeMats>
export const dimMats = (m: Mats): Mat[][] => [m.rock, m.ground, m.grass, m.foe.olive, m.foe.yellow, m.foe.metal, m.foe.lamp]

const triUV = (geo: THREE.BufferGeometry, scale = 7) => {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    const [u, v] = ay > ax && ay > az ? [p.getX(i), p.getZ(i)] : ax > az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]
    uv.setXY(i, u / scale, v / scale)
  }
}
const displace = (geo: THREE.BufferGeometry, f: (x: number, y: number, z: number) => number[]) => {
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) { const [x, y, z] = f(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, x, y, z) }
  geo.computeVertexNormals()
}

const blade = (() => {
  const rows = [[0, 0.032], [0.12, 0.028], [0.25, 0.019], [0.4, 0]], pos: number[] = [], col: number[] = [], idx: number[] = []
  const lo = new THREE.Color(0x2c5518), hi = new THREE.Color(0xb4cf62)
  rows.forEach(([y, w], r) => {
    const c = lo.clone().lerp(hi, y / 0.4), z = y * y * 0.8
    pos.push(-w, y, z, w, y, z); col.push(c.r, c.g, c.b, c.r, c.g, c.b)
    if (r < rows.length - 1) idx.push(r * 2, r * 2 + 1, r * 2 + 2, r * 2 + 1, r * 2 + 3, r * 2 + 2)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx); g.computeVertexNormals(); return g
})()

const treeGeo = (() => {
  const part = (g: THREE.BufferGeometry, y: number, hex: number) => {
    g.translate(0, y, 0)
    const c = new THREE.Color(hex), a: number[] = []
    for (let i = 0; i < g.attributes.position.count; i++) a.push(c.r, c.g, c.b)
    g.setAttribute("color", new THREE.Float32BufferAttribute(a, 3)); return g.toNonIndexed().deleteAttribute("uv")
  }
  const parts = [part(new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6), 0.8, 0x4a3524), part(new THREE.ConeGeometry(1.5, 3.2, 8), 2.6, 0x23401f),
    part(new THREE.ConeGeometry(1.15, 2.7, 8), 4.1, 0x2b4b24), part(new THREE.ConeGeometry(0.8, 2.3, 8), 5.4, 0x345a2a)]
  parts.forEach(g => g.deleteAttribute("normal"))
  const m = mergeGeometries(parts)!; m.computeVertexNormals(); return m
})()

const hillY = (x: number, z: number) => {
  const d = Math.abs(x) - HW - 9
  return 5 + fbm(x * 0.035, z * 0.035, 2) * 16 + Math.max(0, d) * 0.45
}

export const buildSegment = (scene: THREE.Scene, m: Mats, i: number, rng: () => number): Seg => {
  const z0 = -i * SEG, z1 = z0 - SEG, zc = (z0 + z1) / 2
  const s: Seg = { group: new THREE.Group(), boxes: [], enemies: [], clear: i < 2 ? 2 : Math.floor(rng() * N), z0 }
  scene.add(s.group)
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; s.group.add(o); return o
  }

  const floorPiece = (dim: number, za: number, zb: number) => {
    const len = zb - za, zm = (za + zb) / 2
    s.boxes.push({ min: new V(-HW, -3, za), max: new V(HW, 0, zb), dim })
    const body = new THREE.BoxGeometry(HW * 2, 3, len, 4, 1, Math.ceil(len / 5)); triUV(body)
    mesh(body, m.rock[dim], 0, -1.52, zm, false)
    const top = new THREE.PlaneGeometry(HW * 2, len); top.rotateX(-Math.PI / 2)
    const uv = top.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * HW * 2 / 8, uv.getY(k) * len / 8)
    mesh(top, m.ground[dim], 0, 0.002, zm, false)
    const count = Math.round(len * HW * 2 * 2.4), grass = new THREE.InstancedMesh(blade, m.grass[dim], count), dummy = new THREE.Object3D(), c = new THREE.Color()
    for (let k = 0; k < count; k++) {
      dummy.position.set((rng() - 0.5) * HW * 2, 0, za + rng() * len)
      dummy.rotation.set((rng() - 0.5) * 0.3, rng() * 6.3, 0); dummy.scale.set(1, 0.6 + rng() * 1.2, 1).multiplyScalar(0.8 + rng() * 0.7)
      dummy.updateMatrix(); grass.setMatrixAt(k, dummy.matrix); grass.setColorAt(k, c.setHSL(0.24 + rng() * 0.04, 0.45, 0.4 + rng() * 0.25))
    }
    s.group.add(grass)
  }

  const cliff = (dim: number, side: number) => {
    const g = new THREE.BoxGeometry(10, 14, SEG, 5, 10, 24); triUV(g)
    displace(g, (x, y, z) => {
      const out = (x + 5) / 10, seed = i * 3 + dim
      const dx = (fbm(y * 0.2 + seed, z * 0.18, 1) - 0.4) * 2 * (0.15 + out * 3.2)
      const t = (y + 7) / 14, dy = -(t ** 3) * 9 * fbm(x * 0.12 + seed, z * 0.1, 5)
      return [x + dx, y + dy, z + (fbm(x * 0.2, y * 0.2, seed) - 0.4) * 0.8 * out]
    })
    const o = mesh(g, m.rock[dim], side * (HW + 5), 4, zc); o.scale.x = side
    s.boxes.push({ min: new V(side > 0 ? HW : -HW - 1, -3, z1), max: new V(side > 0 ? HW + 1 : -HW, 16, z0), dim })
  }

  const monolith = (dim: number, x: number, z: number, h: number) => {
    s.boxes.push({ min: new V(x - 1, 0, z - 1), max: new V(x + 1, h, z + 1), dim })
    const g = new THREE.CylinderGeometry(0.75, 1.05, h, 7, Math.ceil(h / 0.8)); triUV(g, 5)
    const seed = x + z
    displace(g, (px, py, pz) => {
      const r = 1 + (fbm(px * 0.9 + seed, py * 0.45, pz * 0.9) - 0.5) * 0.7, top = py > h / 2 - 0.01 ? -fbm(px * 2 + seed, pz * 2, 3) * 0.9 : 0
      return [px * r, py + top + h / 2, pz * r]
    })
    mesh(g, m.rock[dim], x, 0, z)
  }

  const floater = (dim: number, x: number, y: number, z: number) => {
    s.boxes.push({ min: new V(x - 2.1, y, z - 2.1), max: new V(x + 2.1, y + 0.5, z + 2.1), dim })
    const g = new THREE.CylinderGeometry(2.7, 1.1, 2.2, 9, 5); triUV(g, 5)
    displace(g, (px, py, pz) => { const r = 1 + (fbm(px * 0.8 + x, py * 0.6, pz * 0.8) - 0.5) * 0.6; return [px * r, py - 0.6 + (py < 1.09 ? (fbm(px, pz, 4) - 0.5) * 0.3 : 0), pz * r] })
    mesh(g, m.rock[dim], x, y + 0.5, z)
    const cap = new THREE.CircleGeometry(2.7, 9); cap.rotateX(-Math.PI / 2)
    mesh(cap, m.ground[dim], x, y + 0.5, z, false)
  }

  const pebble = (dim: number, x: number, z: number, r: number) => {
    const g = new THREE.IcosahedronGeometry(r, 1); displace(g, (px, py, pz) => { const k = 1 + (fbm(px * 3 + x, py * 3, pz * 3) - 0.5); return [px * k, py * k * 0.7, pz * k] })
    mesh(g, m.rock[dim], x, r * 0.25, z)
  }

  for (let dim = 0; dim < N; dim++) {
    const k = i < 2 || dim === s.clear ? 0.3 : rng()
    cliff(dim, -1); cliff(dim, 1)
    if (k < 0.2) { floorPiece(dim, z0 - 10, z0); floorPiece(dim, z1, z0 - 30) } else floorPiece(dim, z1, z0)
    for (let j = 0; j < 7; j++) pebble(dim, (rng() - 0.5) * (HW * 2 - 4), z1 + rng() * SEG, 0.25 + rng() * 0.5)
    if (k > 0.6) for (let j = 0; j < 3; j++) monolith(dim, -HW + 4 + rng() * (HW * 2 - 8), z1 + 3 + rng() * (SEG - 6), 4 + rng() * 6)
    if (rng() < 0.6) floater(dim, (rng() - 0.5) * 16, 3 + rng() * 4, z1 + 3 + rng() * (SEG - 6))
    if (k > 0.35 && k <= 0.6) {
      const pos = new V((rng() - 0.5) * (HW * 2 - 8), 0, z1 + 5 + rng() * (SEG - 10)), w = walker(m.foe, dim)
      w.mesh.position.set(pos.x, 0, pos.z); s.group.add(w.mesh)
      s.enemies.push({ mesh: w.mesh, legs: w.legs, turret: w.turret, pos, dim, hp: 12, fireT: 1 + rng() })
    }
  }

  for (const side of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(70, SEG, 28, 16); geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position, col: number[] = [], c = new THREE.Color()
    for (let k = 0; k < p.count; k++) {
      const wx = side * (HW + 9 + p.getX(k) + 35), wz = zc + p.getZ(k), h = hillY(wx, wz)
      p.setXYZ(k, wx, h, wz)
      const n = fbm(wx * 0.08, wz * 0.08, 9), rocky = Math.max(0, (h - 14) / 14 + (n - 0.5))
      c.setRGB(0.2 + n * 0.22, 0.34 + n * 0.22, 0.12 + n * 0.08).lerp(new THREE.Color(0x7d766a), Math.min(1, rocky))
      col.push(c.r, c.g, c.b)
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals()
    const hill = new THREE.Mesh(geo, m.hill); hill.receiveShadow = true; s.group.add(hill)
    const trees = new THREE.InstancedMesh(treeGeo, m.tree, 18), d = new THREE.Object3D()
    for (let k = 0; k < 18; k++) {
      const wx = side * (HW + 14 + rng() * 55), wz = zc + (rng() - 0.5) * SEG
      d.position.set(wx, hillY(wx, wz) - 0.2, wz); d.rotation.y = rng() * 6; d.scale.set(1, 0.9 + rng() * 0.8, 1).multiplyScalar(1.4 + rng() * 1.6)
      d.updateMatrix(); trees.setMatrixAt(k, d.matrix)
    }
    trees.castShadow = true; s.group.add(trees)
  }
  return s
}
