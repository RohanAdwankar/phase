import * as THREE from "three"
import { PBR, Model, loadPBR, loadModel } from "./assets"
import { N, track, untrack, grassMaterial, terrainY } from "./materials"
import { PALETTE, gradient, groundTexture, flatten } from "./toon"
import { BOULDERS, SLABS } from "./rocks"
import { Enemy, Kind, STATS, makeFoeMats, makeEnemy } from "./actors"

const V = THREE.Vector3
// The world is an endless grid of chunks. Every dimension has its own layout drawn from a hash of its coordinates, so a
// wall in one dimension may be an opening in the next.
export const CH = 40, CELL = 20
// ell marks a boulder: a solid ellipsoid (centre, horizontal radii, centre height, half height) instead of a plain axis-aligned box
// mesh remembers which rock shape sits there and how it was scaled and turned, so shots can hit the real surface
export type Ell = { cx: number; cz: number; rx: number; rz: number; cy: number; hh: number; bot: number; mesh?: { sx: number; sy: number; sz: number; ry: number; set: THREE.BufferGeometry } }
export type Box = { min: THREE.Vector3; max: THREE.Vector3; dim: number; ell?: Ell }
// Push a ground unit (a circle of radius R standing at pos) out of every rock of its dimension: boulders radially, boxes through the nearest face. Returns true if it moved.
export const clearRock = (boxes: Box[], dim: number, pos: THREE.Vector3, R: number) => {
  let moved = false
  for (let it = 0; it < 3; it++) {
    let hit = false
    for (const b of boxes) {
      if (b.dim !== dim) continue
      if (b.ell) {
        const e = b.ell, a = (pos.x - e.cx) / (e.rx + R), c = (pos.z - e.cz) / (e.rz + R), q = a * a + c * c
        if (q >= 1 || pos.y + 0.5 > e.cy + e.hh * Math.sqrt(1 - q)) continue
        const l = Math.sqrt(q)
        if (l < 1e-4) pos.x = e.cx + e.rx + R + 0.05
        else { pos.x = e.cx + (pos.x - e.cx) / l * 1.01; pos.z = e.cz + (pos.z - e.cz) / l * 1.01 }
        hit = moved = true
      } else if (pos.x > b.min.x - R && pos.x < b.max.x + R && pos.z > b.min.z - R && pos.z < b.max.z + R && pos.y + 3 > b.min.y && pos.y < b.max.y) {
        const d = [pos.x - (b.min.x - R), b.max.x + R - pos.x, pos.z - (b.min.z - R), b.max.z + R - pos.z], k = d.indexOf(Math.min(...d))
        if (k === 0) pos.x = b.min.x - R - 0.01; else if (k === 1) pos.x = b.max.x + R + 0.01; else if (k === 2) pos.z = b.min.z - R - 0.01; else pos.z = b.max.z + R + 0.01
        hit = moved = true
      }
    }
    if (!hit) break
  }
  return moved
}
export const ellBox = (cx: number, cy: number, cz: number, rx: number, hh: number, rz: number, dim: number, mesh?: Ell["mesh"]): Box =>
  ({ min: new THREE.Vector3(cx - rx, cy - hh, cz - rz), max: new THREE.Vector3(cx + rx, cy + hh, cz + rz), dim, ell: { cx, cz, rx, rz, cy, hh, bot: cy - hh * 0.62, mesh } })
export type Chunk = {
  cx: number; cz: number; group: THREE.Group; detail: THREE.Group | null; lods: { hi: THREE.Object3D[]; lo: THREE.Object3D[] }
  boxes: Box[]; enemies: Enemy[]; grass: THREE.Material[]; geos: THREE.BufferGeometry[]
}

const TINT = [0xcfeea8, 0xf2e6a0, 0xb8e8b0, 0xecd0a0, 0xd2e0f4]
export const LOAD_STEPS = 2 + 17
const MODELS = ["fir_sapling", "fir_sapling_lo", "pine_sapling_small", "pine_sapling_lo", "fir_sapling_medium", "fir_sapling_medium_lo", "shrub_02", "shrub_03", "fern_02", "grass_medium_01", "grass_medium_02", "dandelion_01", "celandine_01", "periwinkle_plant", "moss_01", "dry_branches_medium_01", "tree_stump_01"]

export const loadWorld = async (onStep: () => void) => {
  const step = <T,>(p: Promise<T>) => p.then(x => (onStep(), x))
  const [olive, metal] = await Promise.all(["green_metal_rust", "metal_plate"].map(id => step(loadPBR(id))))
  const entries = await Promise.all(MODELS.filter(m => m !== "pine_sapling_lo").map(async id => [id, await step(loadModel(id))] as const))
  const models: Record<string, Model> = Object.fromEntries(entries); models.pine_sapling_lo = await step(loadModel("pine_sapling_small_lo"))
  const per = <T,>(f: (i: number) => T) => [...Array(N)].map((_, i) => track(i, f(i) as unknown as THREE.Material) as unknown as T)
  const lane = per(i => { const t = groundTexture(i); t.repeat.set(0.13, 0.13); return new THREE.MeshToonMaterial({ map: t, gradientMap: gradient, transparent: true }) })
  const rockMat = per(i => { const m = flatten(new THREE.MeshStandardMaterial(), PALETTE[i].rock, PALETTE[i].moss) as THREE.MeshStandardMaterial; m.flatShading = true; m.transparent = true; return m })
  const cache = new Map<string, THREE.Material>()
  const matFor = (dim: number, id: string, k: number, src: THREE.Material) => {
    const key = `${dim}:${id}:${k}`
    // photogrammetry scans are open shells; draw both sides so the inside of a torn rim reads as rock instead of a see-through hull
    if (!cache.has(key)) {
      const P = PALETTE[dim], keep = /dandelion|celandine|periwinkle/.test(id)
      const m = keep ? Object.assign(src.clone(), { side: THREE.DoubleSide }) : /fir|pine/.test(id) ? flatten(src, P.tree) : /branches|stump/.test(id) ? flatten(src, 0x6a4a35) : flatten(src, P.plant)
      m.userData.flora = true
      cache.set(key, track(dim, m))
    }
    return cache.get(key)!
  }
  const aoTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(0,0,0,0.6)"); r.addColorStop(0.6, "rgba(0,0,0,0.25)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c) })()
  const ao = per(() => new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  ao.forEach(m => (m.userData.alpha = true))
  return { models, matFor, lane, ao, rock: rockMat, metal, foe: makeFoeMats(olive, metal) }
}
export type World = Awaited<ReturnType<typeof loadWorld>>

export const hash = (...v: number[]) => {
  let h = 2166136261
  for (const n of v) { h ^= Math.floor(n) | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x85ebca6b) }
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
const rngFrom = (...v: number[]) => { let s = Math.floor(hash(...v) * 4294967296); return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const fmod = (a: number, b: number) => ((a % b) + b) % b

// Fractal maze: cliff walls sit on the lines of a 20 m lattice at three scales (20, 40 and 80 m). Bigger walls are
// longer but always contain a doorway, small walls can block outright. Each dimension rolls its own dice.
const WALL_P = [0.46, 0.42, 0.38]
export const wallAt = (dim: number, vertical: boolean, i: number, j: number) => {
  const mx = vertical ? i * CELL : (j + 0.5) * CELL, mz = vertical ? (j + 0.5) * CELL : i * CELL
  if (Math.hypot(mx, mz) < 38) return false
  for (let k = 0; k < 3; k++) {
    const s = 1 << k
    if (fmod(i, s) !== 0) continue
    const seg = Math.floor(j / s), v = vertical ? 1 : 0
    if (hash(dim, v, i, seg, s) >= WALL_P[k]) continue
    if (s === 1 || fmod(j, s) !== Math.floor(hash(dim, 7, v, i, seg, s) * s)) return true
  }
  return false
}

const triUV = (geo: THREE.BufferGeometry, scale = 5) => {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    const [u, v] = ay > ax && ay > az ? [p.getX(i), p.getZ(i)] : ax > az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]
    uv.setXY(i, u / scale, v / scale)
  }
}

const blade = (() => {
  // an arched blade: wide at the base, curving over and drooping toward a fine tip
  const rows = [[0, 0.036], [0.12, 0.034], [0.28, 0.029], [0.46, 0.021], [0.64, 0.012], [0.8, 0]], pos: number[] = [], col: number[] = [], idx: number[] = []
  const lo = new THREE.Color(0xc4c4c4), mid = new THREE.Color(0xe2e2e2), hi = new THREE.Color(0xffffff)
  rows.forEach(([y, wd], r) => {
    const c = y < 0.4 ? lo.clone().lerp(mid, y / 0.4) : mid.clone().lerp(hi, (y - 0.4) / 0.4), z = y * y * 0.9 + y * y * y * 1.4
    pos.push(-wd, y, z, wd, y, z); col.push(c.r, c.g, c.b, c.r, c.g, c.b)
    if (r < rows.length - 1) idx.push(r * 2, r * 2 + 1, r * 2 + 2, r * 2 + 1, r * 2 + 3, r * 2 + 2)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx)
  return g
})()

const mat4 = (x: number, y: number, z: number, ry: number, sx: number, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new V(sx, sy, sz))

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`
export const spawn = new V(0, 0, 0)

export const buildChunk = (scene: THREE.Scene, w: World, cx: number, cz: number): Chunk => {
  const x0 = cx * CH, z0 = cz * CH
  const c: Chunk = { cx, cz, group: new THREE.Group(), detail: null, lods: { hi: [], lo: [] }, boxes: [], enemies: [], grass: [], geos: [] }
  scene.add(c.group)
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true) => {
    const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; c.geos.push(geo); c.group.add(o); return o
  }
  const place = (id: string, dim: number, ms: THREE.Matrix4[], parent: THREE.Object3D = c.group, shadow = true) => {
    const model = w.models[id], out: THREE.InstancedMesh[] = []
    model.parts.forEach((p, k) => {
      const im = new THREE.InstancedMesh(p.geo, w.matFor(dim, id, k, p.mat), ms.length)
      ms.forEach((m, j) => im.setMatrixAt(j, m)); im.castShadow = shadow; im.receiveShadow = true; im.computeBoundingSphere(); parent.add(im); out.push(im)
    })
    return out
  }
  // thick boulders as instanced geometry; each entry is [x, y, z, radiusX, height, radiusZ, rotation, variant]
  const pending = new Map<string, { dim: number; geo: THREE.BufferGeometry; ms: THREE.Matrix4[] }>()
  const boulders = (dim: number, list: number[][], slab = false) => {
    const set = slab ? SLABS : BOULDERS
    for (const [x, y, z, rx, h, rz, ry, v] of list) {
      const k = Math.floor(v) % set.length, key = `${dim}:${slab}:${k}`
      ;(pending.get(key) ?? pending.set(key, { dim, geo: set[k], ms: [] }).get(key)!).ms.push(mat4(x, y, z, ry, rx, h, rz))
    }
  }
  // one instanced draw per dimension and shape for the whole chunk
  const flushBoulders = () => {
    for (const { dim, geo, ms } of pending.values()) {
      const im = new THREE.InstancedMesh(geo, w.rock[dim], ms.length); ms.forEach((m, j) => im.setMatrixAt(j, m)); im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); c.group.add(im)
    }
  }
  const blob = (dim: number, x: number, z: number, sx: number, sz: number, rot = 0) => {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), w.ao[dim]); o.position.set(x, terrainY(x, z, dim) + 0.2, z); o.rotation.y = rot; o.scale.set(sx, 1, sz); o.renderOrder = 1; c.geos.push(o.geometry); c.group.add(o)
  }
  const near0 = (x: number, z: number, r: number) => Math.hypot(x, z) < r

  for (let dim = 0; dim < N; dim++) {
    const rng = rngFrom(cx, cz, dim, 1)
    // terrain
    const geo = new THREE.PlaneGeometry(CH, CH, 40, 40); geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position, uv = geo.attributes.uv
    for (let n = 0; n < p.count; n++) {
      const wx = x0 + CH / 2 + p.getX(n), wz = z0 + CH / 2 + p.getZ(n)
      p.setXYZ(n, wx, terrainY(wx, wz, dim), wz); uv.setXY(n, wx / 4, wz / 4)
    }
    geo.computeVertexNormals()
    mesh(geo, w.lane[dim], 0, 0, 0, false)

    for (let ci = cx * 2; ci < cx * 2 + 2; ci++) for (let cj = cz * 2; cj < cz * 2 + 2; cj++) {
      const r = rngFrom(ci, cj, dim, 2)
      const cxm = (ci + 0.5) * CELL, czm = (cj + 0.5) * CELL
      // standing stones
      if (r() < 0.38 && !near0(cxm, czm, 26)) for (let j = 0; j < 1 + Math.floor(r() * 2); j++) {
        const x = cxm + (r() - 0.5) * 8, z = czm + (r() - 0.5) * 8, h = 2.4 + r() * 2.6, rad = 1.5 + r() * 1.2, ty = terrainY(x, z, dim), hx = rad * 0.78
        const rz2 = rad * (0.8 + 0.4 * r()), ry = r() * 6.28, v = r() * 4; boulders(dim, [[x, ty + h * 0.45, z, rad, h, rz2, ry, v]]); blob(dim, x, z, rad * 4, rad * 4)
        c.boxes.push(ellBox(x, ty + h * 0.45, z, rad * 1.12, h * 0.97, rz2 * 1.12, dim, { sx: rad, sy: h, sz: rz2, ry, set: BOULDERS[Math.floor(v) % BOULDERS.length] }))
      }
      // floating rocks to jump between
      if (r() < 0.3 && !near0(cxm, czm, 20)) {
        const x = cxm + (r() - 0.5) * 8, z = czm + (r() - 0.5) * 8, y = terrainY(x, z, dim) + 3 + r() * 4
        c.boxes.push({ min: new V(x - 2.3, y, z - 2.3), max: new V(x + 2.3, y + 0.5, z + 2.3), dim })
        boulders(dim, [[x, y + 0.5 - 0.6 * 1.4, z, 3.1, 1.4, 3.1, r() * 6.28, r() * 2]], true)
      }
      // a patrol: a mix of walkers, swarmers that come in packs, flying drones and the occasional brute
      if (r() < 0.6 && !near0(cxm, czm, 30)) {
        const roll = r(), kind: Kind = roll < 0.4 ? "walker" : roll < 0.7 ? "swarmer" : roll < 0.88 ? "flyer" : "brute"
        const n = kind === "swarmer" ? 3 + Math.floor(r() * 3) : kind === "walker" && r() < 0.4 ? 2 : 1
        for (let m = 0; m < n; m++) {
          const pos = new V(cxm + (r() - 0.5) * 12, 0, czm + (r() - 0.5) * 12), rr = STATS[kind].r
          if (c.enemies.some(o => o.dim === dim && Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z) < o.r + rr + 0.6)) continue
          const e = makeEnemy(kind, w.foe, dim, pos)
          pos.y = terrainY(pos.x, pos.z, dim) + e.fy; e.mesh.position.copy(pos); c.group.add(e.mesh); if (kind !== "flyer") blob(dim, pos.x, pos.z, rr * 3, rr * 3)
          c.enemies.push(e)
        }
      }
    }
    // fractal maze walls: this chunk owns the lattice lines that fall inside it
    for (const vertical of [true, false]) for (let i = (vertical ? cx : cz) * 2; i < (vertical ? cx : cz) * 2 + 2; i++) for (let j = (vertical ? cz : cx) * 2; j < (vertical ? cz : cx) * 2 + 2; j++) {
      if (!wallAt(dim, vertical, i, j)) continue
      const wx = vertical ? i * CELL : (j + 0.5) * CELL, wz = vertical ? (j + 0.5) * CELL : i * CELL, ty = terrainY(wx, wz, dim)
      // a wall is a run of overlapping thick boulders along the lattice line, with a collider covering the same footprint
      const list: number[][] = [], n = 6, r = rngFrom(i, j, dim, vertical ? 3 : 4)
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n - 0.5, along = t * CELL * 1.15, h = 6.5 + r() * 5, rad = 3.2 + r() * 1.2, off = (r() - 0.5) * 1.2
        const bx = vertical ? wx + off : wx + along, bz = vertical ? wz + along : wz + off
        list.push([bx, terrainY(bx, bz, dim) + h * 0.38, bz, rad * (vertical ? 1 : 1.35), h, rad * (vertical ? 1.35 : 1), r() * 6.28, r() * 4])
      }
      boulders(dim, list)
      for (const [bx, by, bz, rx, h, rz, ry, v] of list) c.boxes.push(ellBox(bx, by, bz, rx * 1.12, h * 0.97, rz * 1.12, dim, { sx: rx, sy: h, sz: rz, ry, set: BOULDERS[Math.floor(v) % BOULDERS.length] }))
      blob(dim, wx, wz, vertical ? 8 : CELL * 1.2, vertical ? CELL * 1.2 : 8)
    }
  }

  flushBoulders()
  for (const e of c.enemies) { clearRock(c.boxes, e.dim, e.pos, e.r); e.pos.y = terrainY(e.pos.x, e.pos.z, e.dim) + e.fy; e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z) }

  // trees stand on each dimension's own ground: the full-detail copy shows near the player and a cheap copy further out
  for (let dim = 0; dim < N; dim++) {
    const tr = rngFrom(cx, cz, 77 + dim)
    for (const [hi, lo] of [["fir_sapling", "fir_sapling_lo"], ["pine_sapling_small", "pine_sapling_lo"], ["fir_sapling_medium", "fir_sapling_medium_lo"]]) {
      const ms = [...Array(2)].map(() => {
        const x = x0 + tr() * CH, z = z0 + tr() * CH, sz = w.models[hi].box.getSize(new V()), sc = (11 + tr() * 8) / sz.y
        return mat4(x, terrainY(x, z, dim) - 0.3, z, tr() * 6.28, sc)
      }).filter(m => { const q = new V().setFromMatrixPosition(m); return !near0(q.x, q.z, 14) })
      if (!ms.length) continue
      for (const [id, list] of [[hi, c.lods.hi], [lo, c.lods.lo]] as const) for (const im of place(id, dim, ms)) list.push(im)
    }
  }
  return c
}

// Grass and ground cover only exist near the player, so they are built when a chunk gets close and dropped when it is far.
export const buildDetail = (w: World, c: Chunk) => {
  const x0 = c.cx * CH, z0 = c.cz * CH, d = (c.detail = new THREE.Group()); c.group.add(d)
  for (let dim = 0; dim < N; dim++) {
    const r = rngFrom(c.cx, c.cz, dim, 3)
    for (const [density, under] of [[9, false], [11, true]] as const) {
      const g = new THREE.InstancedBufferGeometry(); g.index = blade.index; for (const [name, a] of Object.entries(blade.attributes)) g.setAttribute(name, a)
      g.instanceCount = Math.round(CH * CH * density); g.boundingSphere = new THREE.Sphere(new V(x0 + CH / 2, terrainY(x0 + CH / 2, z0 + CH / 2, dim) + 0.4, z0 + CH / 2), CH * 0.75)
      const gm = grassMaterial(new THREE.Vector4(x0, z0, CH, CH), PALETTE[dim].blade, under, dim); gm.userData.flora = true; track(dim, gm); c.grass.push(gm)
      d.add(new THREE.Mesh(g, gm))
    }
    const spots = (n: number) => [...Array(n)].map(() => { const x = x0 + r() * CH, z = z0 + r() * CH; return new V(x, terrainY(x, z, dim), z) })
    const scatter = (id: string, n: number, lo: number, hi: number) => place(id, dim, spots(n).map(q => mat4(q.x, q.y, q.z, r() * 6.28, lo + r() * (hi - lo))))
    const place = (id: string, dm: number, ms: THREE.Matrix4[]) => w.models[id].parts.map((p, k) => {
      const im = new THREE.InstancedMesh(p.geo, w.matFor(dm, id, k, p.mat), Math.max(1, ms.length)); im.count = ms.length
      ms.forEach((m, j) => im.setMatrixAt(j, m)); im.receiveShadow = true; im.computeBoundingSphere(); d.add(im); return im
    })
    scatter("fern_02", 5, 0.7, 1.4); scatter("dandelion_01", 14, 0.8, 1.3); scatter("celandine_01", 32, 0.8, 1.5); scatter("periwinkle_plant", 7, 0.8, 1.3)
    scatter("grass_medium_01", 32, 0.8, 1.6); scatter("grass_medium_02", 28, 0.8, 1.6); scatter("moss_01", 9, 0.8, 1.6); scatter("shrub_02", 4, 0.9, 1.7); scatter("shrub_03", 2, 0.9, 1.6)
    scatter("dry_branches_medium_01", 1, 0.6, 1.1)
    { const ms = spots(5).map(q => mat4(q.x, q.y + 0.1, q.z, r() * 6.28, 0.35 + r() * 0.5, 0.3 + r() * 0.3, 0.35 + r() * 0.5)); if (ms.length) { const im = new THREE.InstancedMesh(BOULDERS[Math.floor(r() * 4)], w.rock[dim], ms.length); ms.forEach((m, j) => im.setMatrixAt(j, m)); im.computeBoundingSphere(); d.add(im) } }
  }
}

export const disposeDetail = (c: Chunk) => {
  if (!c.detail) return
  c.detail.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) m.geometry.dispose() })
  c.detail.removeFromParent(); c.detail = null
  for (let d = 0; d < N; d++) untrack(d, c.grass)
  c.grass = []
}

export const disposeChunk = (c: Chunk) => {
  disposeDetail(c); c.group.removeFromParent(); c.geos.forEach(g => g.dispose())
}
