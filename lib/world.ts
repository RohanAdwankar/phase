import * as THREE from "three"
import { PBR, Model, loadPBR, loadModel } from "./assets"
import { N, track, untrack, splatMaterial, grassMaterial, terrainY } from "./materials"
import { Enemy, makeFoeMats, walker } from "./actors"

const V = THREE.Vector3
// The world is an endless grid of chunks. Every dimension has its own layout drawn from a hash of its coordinates, so a
// wall in one dimension may be an opening in the next.
export const CH = 40, CELL = 20
export type Box = { min: THREE.Vector3; max: THREE.Vector3; dim: number }
export type Pit = { x0: number; x1: number; z0: number; z1: number; dim: number }
export type Chunk = {
  cx: number; cz: number; group: THREE.Group; detail: THREE.Group | null; lods: { hi: THREE.Object3D[]; lo: THREE.Object3D[] }
  boxes: Box[]; pits: Pit[]; enemies: Enemy[]; grass: THREE.Material[]; geos: THREE.BufferGeometry[]
}

const TINT = [0xcfeea8, 0xf2e6a0, 0xb8e8b0, 0xecd0a0, 0xd2e0f4]
const MODELS = ["namaqualand_boulder_02", "namaqualand_boulder_03", "namaqualand_boulder_04", "namaqualand_boulder_05", "boulder_01", "namaqualand_cliff_01", "namaqualand_cliff_02", "mountainside", "coastal_cliff_02",
  "namaqualand_cliff_01_lo", "namaqualand_cliff_02_lo", "mountainside_lo", "coastal_cliff_02_lo", "fir_sapling", "fir_sapling_lo", "pine_sapling_small", "pine_sapling_lo", "fir_sapling_medium", "fir_sapling_medium_lo", "shrub_02", "shrub_03", "fern_02", "grass_medium_01", "grass_medium_02", "dandelion_01", "celandine_01", "periwinkle_plant", "moss_01", "dry_branches_medium_01", "tree_stump_01"]

export const loadWorld = async () => {
  const [grass, dry, rock, olive, metal, forest, scree] = await Promise.all(["leafy_grass", "aerial_grass_rock", "rock_face", "green_metal_rust", "metal_plate", "forrest_ground_01", "dry_ground_rocks"].map(loadPBR))
  const biome: [PBR, PBR][] = [[grass, dry], [dry, scree], [forest, rock], [scree, dry], [grass, forest]]
  const entries = await Promise.all(MODELS.filter(m => m !== "pine_sapling_lo").map(async id => [id, await loadModel(id)] as const))
  const models: Record<string, Model> = Object.fromEntries(entries); models.pine_sapling_lo = await loadModel("pine_sapling_small_lo")
  const per = <T,>(f: (i: number) => T) => [...Array(N)].map((_, i) => track(i, f(i) as unknown as THREE.Material) as unknown as T)
  const lane = per(i => splatMaterial(biome[i][0], biome[i][1], { scaleB: 0.8, tint: TINT[i], c: biome[(i + 2) % 5][0] }))
  const cache = new Map<string, THREE.Material>()
  const matFor = (dim: number, id: string, k: number, src: THREE.Material) => {
    const key = `${dim}:${id}:${k}`
    if (!cache.has(key)) cache.set(key, track(dim, src.clone()))
    return cache.get(key)!
  }
  const aoTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(0,0,0,0.6)"); r.addColorStop(0.6, "rgba(0,0,0,0.25)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c) })()
  const ao = per(() => new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  return { models, matFor, lane, ao, metal, foe: makeFoeMats(olive, metal) }
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
  const lo = new THREE.Color(0x26441a), mid = new THREE.Color(0x58982a), hi = new THREE.Color(0xaed45c)
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
  const c: Chunk = { cx, cz, group: new THREE.Group(), detail: null, lods: { hi: [], lo: [] }, boxes: [], pits: [], enemies: [], grass: [], geos: [] }
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
  const blob = (dim: number, x: number, z: number, sx: number, sz: number, rot = 0) => {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), w.ao[dim]); o.position.set(x, terrainY(x, z) + 0.2, z); o.rotation.y = rot; o.scale.set(sx, 1, sz); o.renderOrder = 1; c.geos.push(o.geometry); c.group.add(o)
  }
  const near0 = (x: number, z: number, r: number) => Math.hypot(x, z) < r

  for (let dim = 0; dim < N; dim++) {
    const rng = rngFrom(cx, cz, dim, 1)
    // chasm: a square hole in one cell
    if (rng() < 0.16) {
      const ci = cx * 2 + Math.floor(rng() * 2), cj = cz * 2 + Math.floor(rng() * 2), px = (ci + 0.5) * CELL + (rng() - 0.5) * 4, pz = (cj + 0.5) * CELL + (rng() - 0.5) * 4, hs = 4 + rng() * 1.5
      if (!near0(px, pz, 34)) c.pits.push({ x0: px - hs, x1: px + hs, z0: pz - hs, z1: pz + hs, dim })
    }
    // terrain, with the chasm carved into the vertex heights
    const geo = new THREE.PlaneGeometry(CH, CH, 40, 40); geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position, uv = geo.attributes.uv, pits = c.pits.filter(q => q.dim === dim)
    for (let n = 0; n < p.count; n++) {
      const wx = x0 + CH / 2 + p.getX(n), wz = z0 + CH / 2 + p.getZ(n)
      let drop = 0
      for (const q of pits) { const d = Math.max(q.x0 - wx, wx - q.x1, q.z0 - wz, wz - q.z1); drop = Math.max(drop, Math.min(1, Math.max(0, (0.3 - d) / 0.8)) * 9) }
      p.setXYZ(n, wx, terrainY(wx, wz) - drop, wz); uv.setXY(n, wx / 4, wz / 4)
    }
    geo.computeVertexNormals()
    mesh(geo, w.lane[dim], 0, 0, 0, false)

    for (let ci = cx * 2; ci < cx * 2 + 2; ci++) for (let cj = cz * 2; cj < cz * 2 + 2; cj++) {
      const r = rngFrom(ci, cj, dim, 2)
      const cxm = (ci + 0.5) * CELL, czm = (cj + 0.5) * CELL
      // standing stones
      if (r() < 0.38 && !near0(cxm, czm, 26)) for (let j = 0; j < 1 + Math.floor(r() * 2); j++) {
        const id = ["namaqualand_boulder_03", "namaqualand_boulder_05", "boulder_01"][Math.floor(r() * 3)], sz = w.models[id].box.getSize(new V())
        const x = cxm + (r() - 0.5) * 8, z = czm + (r() - 0.5) * 8, h = 4 + r() * 5, sc = h / sz.y, hx = sz.x * sc * 0.75 * 0.36, hz = sz.z * sc * 0.75 * 0.36, half = Math.max(hx, hz), ty = terrainY(x, z)
        if (pits.some(q => x > q.x0 - 3 && x < q.x1 + 3 && z > q.z0 - 3 && z < q.z1 + 3)) continue
        place(id, dim, [mat4(x, ty - 0.2, z, r() * 6.28, sc * 0.75, sc, sc * 0.75)]); blob(dim, x, z, half * 6, half * 6)
        c.boxes.push({ min: new V(x - hx, ty - 0.6, z - hz), max: new V(x + hx, ty + h * 0.92, z + hz), dim })
      }
      // floating rocks to jump between
      if (r() < 0.3 && !near0(cxm, czm, 20)) {
        const x = cxm + (r() - 0.5) * 8, z = czm + (r() - 0.5) * 8, y = terrainY(x, z) + 3 + r() * 4, id = r() < 0.5 ? "namaqualand_boulder_03" : "namaqualand_boulder_05", sz = w.models[id].box.getSize(new V())
        c.boxes.push({ min: new V(x - 2.1, y, z - 2.1), max: new V(x + 2.1, y + 0.5, z + 2.1), dim })
        place(id, dim, [mat4(x, y + 0.5 - 1.6, z, r() * 6.28, 5.4 / Math.max(sz.x, sz.z), 1.6 / sz.y, 5.4 / Math.max(sz.x, sz.z))])
        const cap = new THREE.CircleGeometry(2.6, 24); cap.rotateX(-Math.PI / 2); mesh(cap, w.lane[dim], x, y + 0.5, z, false)
      }
      // a patrol of walkers
      if (r() < 0.2 && !near0(cxm, czm, 40)) {
        const pos = new V(cxm + (r() - 0.5) * 8, 0, czm + (r() - 0.5) * 8), wk = walker(w.foe, dim)
        pos.y = terrainY(pos.x, pos.z); wk.mesh.position.copy(pos); c.group.add(wk.mesh); blob(dim, pos.x, pos.z, 5.5, 5.5)
        c.enemies.push({ mesh: wk.mesh, update: wk.update, turret: wk.turret, pos, dim, hp: 12, fireT: 1 + r(), hitT: 0 })
      }
    }

    // fractal maze walls: this chunk owns the lattice lines that fall inside it
    for (const vertical of [true, false]) for (let i = (vertical ? cx : cz) * 2; i < (vertical ? cx : cz) * 2 + 2; i++) for (let j = (vertical ? cz : cx) * 2; j < (vertical ? cz : cx) * 2 + 2; j++) {
      if (!wallAt(dim, vertical, i, j)) continue
      const wx = vertical ? i * CELL : (j + 0.5) * CELL, wz = vertical ? (j + 0.5) * CELL : i * CELL, ty = terrainY(wx, wz)
      const id = ["namaqualand_cliff_01", "namaqualand_cliff_02", "mountainside", "coastal_cliff_02"][Math.floor(hash(dim, i, j, vertical ? 1 : 0, 9) * 4)]
      const sz = w.models[id].box.getSize(new V()), longX = sz.x > sz.z, long = Math.max(sz.x, sz.z), thick = Math.min(sz.x, sz.z)
      const sl = Math.min(CELL * 1.12 / long, 17 / sz.y), st = Math.min(sl, 5.2 / thick), ry = (vertical ? 0 : Math.PI / 2) + (longX ? Math.PI / 2 : 0) + (hash(dim, i, j, 5) < 0.5 ? 0 : Math.PI)
      const m = [mat4(wx, ty - 1.2, wz, ry, longX ? sl : st, sl * (0.9 + 0.3 * hash(dim, i, j, 6)), longX ? st : sl)]
      c.lods.hi.push(...place(id, dim, m)); c.lods.lo.push(...place(id + "_lo", dim, m))
      // collide against the real footprint of the placed rock, not a thin slab
      const bb = w.models[id].box.clone().applyMatrix4(m[0]), sh = 0.06 * Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
      c.boxes.push({ min: new V(bb.min.x + sh, -30, bb.min.z + sh), max: new V(bb.max.x - sh, bb.max.y, bb.max.z - sh), dim })
      blob(dim, wx, wz, vertical ? 8 : CELL * 1.2, vertical ? CELL * 1.2 : 8)
    }
  }

  // trees are shared by every dimension; the full-detail copy shows near the player and a cheap copy further out
  const tr = rngFrom(cx, cz, 77)
  for (const [hi, lo] of [["fir_sapling", "fir_sapling_lo"], ["pine_sapling_small", "pine_sapling_lo"], ["fir_sapling_medium", "fir_sapling_medium_lo"]]) {
    const ms = [...Array(2)].map(() => {
      const x = x0 + tr() * CH, z = z0 + tr() * CH, sz = w.models[hi].box.getSize(new V()), sc = (11 + tr() * 8) / sz.y
      return mat4(x, terrainY(x, z) - 0.3, z, tr() * 6.28, sc)
    }).filter(m => { const q = new V().setFromMatrixPosition(m); return !near0(q.x, q.z, 14) })
    if (!ms.length) continue
    for (const [id, list] of [[hi, c.lods.hi], [lo, c.lods.lo]] as const) for (const im of place(id, 0, ms)) {
      const mats = Array.isArray(im.material) ? im.material : [im.material]; mats.forEach(mm => untrack(0, [mm])); list.push(im)
    }
  }
  return c
}

// Grass and ground cover only exist near the player, so they are built when a chunk gets close and dropped when it is far.
export const buildDetail = (w: World, c: Chunk) => {
  const x0 = c.cx * CH, z0 = c.cz * CH, d = (c.detail = new THREE.Group()); c.group.add(d)
  for (let dim = 0; dim < N; dim++) {
    const r = rngFrom(c.cx, c.cz, dim, 3), pits = c.pits.filter(q => q.dim === dim)
    const ok = (x: number, z: number) => !pits.some(q => x > q.x0 - 1.5 && x < q.x1 + 1.5 && z > q.z0 - 1.5 && z < q.z1 + 1.5)
    for (const [density, under] of [[18, false], [22, true]] as const) {
      const g = new THREE.InstancedBufferGeometry(); g.index = blade.index; for (const [name, a] of Object.entries(blade.attributes)) g.setAttribute(name, a)
      g.instanceCount = Math.round(CH * CH * density); g.boundingSphere = new THREE.Sphere(new V(x0 + CH / 2, terrainY(x0 + CH / 2, z0 + CH / 2) + 0.4, z0 + CH / 2), CH * 0.75)
      const gm = grassMaterial(new THREE.Vector4(x0, z0, CH, CH), TINT[dim], under); track(dim, gm); c.grass.push(gm)
      d.add(new THREE.Mesh(g, gm))
    }
    const spots = (n: number) => [...Array(n)].map(() => { const x = x0 + r() * CH, z = z0 + r() * CH; return new V(x, terrainY(x, z), z) }).filter(q => ok(q.x, q.z))
    const scatter = (id: string, n: number, lo: number, hi: number) => place(id, dim, spots(n).map(q => mat4(q.x, q.y, q.z, r() * 6.28, lo + r() * (hi - lo))))
    const place = (id: string, dm: number, ms: THREE.Matrix4[]) => w.models[id].parts.map((p, k) => {
      const im = new THREE.InstancedMesh(p.geo, w.matFor(dm, id, k, p.mat), Math.max(1, ms.length)); im.count = ms.length
      ms.forEach((m, j) => im.setMatrixAt(j, m)); im.receiveShadow = true; im.computeBoundingSphere(); d.add(im); return im
    })
    scatter("fern_02", 5, 0.7, 1.4); scatter("dandelion_01", 14, 0.8, 1.3); scatter("celandine_01", 32, 0.8, 1.5); scatter("periwinkle_plant", 7, 0.8, 1.3)
    scatter("grass_medium_01", 32, 0.8, 1.6); scatter("grass_medium_02", 28, 0.8, 1.6); scatter("moss_01", 9, 0.8, 1.6); scatter("shrub_02", 4, 0.9, 1.7); scatter("shrub_03", 2, 0.9, 1.6)
    scatter("dry_branches_medium_01", 1, 0.6, 1.1)
    place(["namaqualand_boulder_02", "namaqualand_boulder_04"][Math.floor(r() * 2)], dim, spots(4).map(q => mat4(q.x, q.y - 0.05, q.z, r() * 6.28, 0.12 + r() * 0.3)))
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
