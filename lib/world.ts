import * as THREE from "three"
import { fbm } from "./noise"
import { PBR, Model, loadPBR, loadModel } from "./assets"
import { N, track, untrack, pbrMaterial, splatMaterial, grassMaterial, terrainY } from "./materials"
import { Enemy, makeFoeMats, walker } from "./actors"

const V = THREE.Vector3
export const SEG = 40, HW = 16
export type Box = { min: THREE.Vector3; max: THREE.Vector3; dim: number; floor?: boolean }
export type Seg = { group: THREE.Group; detail: THREE.Group; trees: { hi: THREE.Object3D[]; lo: THREE.Object3D[] }; boxes: Box[]; enemies: Enemy[]; clear: number; z0: number; grass: THREE.Material[]; geos: THREE.BufferGeometry[] }

const TINT = [0xffffff, 0xf2e2a0, 0xc4e4b4, 0xeccaa0, 0xdce2ff]
const MODELS = ["namaqualand_boulder_02", "namaqualand_boulder_03", "namaqualand_boulder_04", "namaqualand_boulder_05", "boulder_01", "namaqualand_cliff_01", "namaqualand_cliff_02", "mountainside", "coastal_cliff_02",
  "namaqualand_cliff_01_lo", "namaqualand_cliff_02_lo", "mountainside_lo", "coastal_cliff_02_lo", "fir_sapling", "fir_sapling_lo", "pine_sapling_small", "pine_sapling_lo", "fir_sapling_medium", "fir_sapling_medium_lo", "shrub_02", "shrub_03", "fern_02", "grass_medium_01", "grass_medium_02", "dandelion_01", "celandine_01", "periwinkle_plant", "moss_01", "dry_branches_medium_01", "tree_stump_01"]

export const loadWorld = async () => {
  const [grass, dry, rock, cliff, olive, metal, forest, scree] = await Promise.all(["leafy_grass", "aerial_grass_rock", "rock_face", "cliff_side", "green_metal_rust", "metal_plate", "forrest_ground_01", "dry_ground_rocks"].map(loadPBR))
  const biome: [PBR, PBR][] = [[grass, dry], [dry, scree], [forest, rock], [scree, dry], [grass, forest]]
  const entries = await Promise.all(MODELS.filter(m => m !== "pine_sapling_lo").map(async id => [id, await loadModel(id)] as const))
  const models: Record<string, Model> = Object.fromEntries(entries); models.pine_sapling_lo = await loadModel("pine_sapling_small_lo")
  const per = <T,>(f: (i: number) => T) => [...Array(N)].map((_, i) => track(i, f(i) as unknown as THREE.Material) as unknown as T)
  const lane = per(i => splatMaterial(biome[i][0], biome[i][1], { scaleB: 0.8, tint: TINT[i], c: biome[(i + 2) % 5][0] }))
  const body = per(i => pbrMaterial(cliff, { tint: TINT[i] }))
  const rockMat = per(i => pbrMaterial(rock, { tint: TINT[i] }))
  const cache = new Map<string, THREE.Material>()
  const matFor = (dim: number, id: string, k: number, src: THREE.Material) => {
    const key = `${dim}:${id}:${k}`
    if (!cache.has(key)) cache.set(key, track(dim, src.clone()))
    return cache.get(key)!
  }
  const aoTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(0,0,0,0.6)"); r.addColorStop(0.6, "rgba(0,0,0,0.25)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c) })()
  const ao = per(() => new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  const hill = splatMaterial(grass, forest, { scaleB: 0.7, attr: true, tint: 0xc4cfb4 }); hill.transparent = false
  return { grass, dry, rock, cliff, olive, metal, lane, body, rockMat, models, matFor, hill, ao, foe: makeFoeMats(olive, metal) }
}
export type World = Awaited<ReturnType<typeof loadWorld>>

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
  const rows = [[0, 0.024], [0.12, 0.023], [0.28, 0.02], [0.46, 0.015], [0.64, 0.009], [0.8, 0]], pos: number[] = [], col: number[] = [], idx: number[] = []
  const lo = new THREE.Color(0x1a2c0e), mid = new THREE.Color(0x4a6f22), hi = new THREE.Color(0xa6b660)
  rows.forEach(([y, wd], r) => {
    const c = y < 0.4 ? lo.clone().lerp(mid, y / 0.4) : mid.clone().lerp(hi, (y - 0.4) / 0.4), z = y * y * 0.9 + y * y * y * 1.4
    pos.push(-wd, y, z, wd, y, z); col.push(c.r, c.g, c.b, c.r, c.g, c.b)
    if (r < rows.length - 1) idx.push(r * 2, r * 2 + 1, r * 2 + 2, r * 2 + 1, r * 2 + 3, r * 2 + 2)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx)
  return g
})()


export const hillY = (x: number, z: number) => {
  const a = Math.abs(x) - HW - 6, ramp = Math.min(1, Math.max(0, a / 45)), d = Math.max(0, a - 45)
  return (4 + fbm(x * 0.03, z * 0.03, 2) * 22 + d * 0.5 + fbm(x * 0.12, z * 0.12, 5) * 3) * ramp * ramp * (3 - 2 * ramp)
}

export const buildSegment = (scene: THREE.Scene, w: World, i: number, rng: () => number): Seg => {
  const z0 = -i * SEG, z1 = z0 - SEG, zc = (z0 + z1) / 2
  const s: Seg = { group: new THREE.Group(), detail: new THREE.Group(), trees: { hi: [], lo: [] }, boxes: [], enemies: [], clear: i < 2 ? 2 : Math.floor(rng() * N), z0, grass: [], geos: [] }
  s.group.add(s.detail); scene.add(s.group)
  const add = (o: THREE.Object3D, parent: THREE.Object3D = s.group) => { parent.add(o); return o }
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true) => {
    const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; s.geos.push(geo); return add(o)
  }
  const place = (id: string, dim: number, ms: THREE.Matrix4[], parent: THREE.Object3D = s.detail, shadow = true) => {
    const model = w.models[id], out: THREE.InstancedMesh[] = []
    model.parts.forEach((p, k) => {
      const im = new THREE.InstancedMesh(p.geo, w.matFor(dim, id, k, p.mat), ms.length)
      ms.forEach((m, j) => im.setMatrixAt(j, m)); im.castShadow = shadow; im.receiveShadow = true; im.computeBoundingSphere(); parent.add(im); out.push(im)
    })
    return out
  }
  const mat4 = (x: number, y: number, z: number, ry: number, sx: number, sy = sx, sz = sx, mirror = 1) =>
    new THREE.Matrix4().compose(new V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new V(sx * mirror, sy, sz))
  const pick = (...ids: string[]) => ids[Math.floor(rng() * ids.length)]

  const blob = (dim: number, x: number, z: number, sx: number, sz: number, parent: THREE.Object3D = s.group) => {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), w.ao[dim]); o.position.set(x, parent === s.group ? terrainY(x, z) + 0.06 : 0.03, z); o.scale.set(sx, 1, sz); o.renderOrder = 1; s.geos.push(o.geometry); parent.add(o)
  }
  const pit = (k: number) => k < 0.2
  for (let dim = 0; dim < N; dim++) {
    const k = i < 2 || dim === s.clear ? 0.3 : rng()
    const onFloor = (x: number, z: number) => !pit(k) || !(z < z0 - 10 && z > z0 - 30)
    const pieces = pit(k) ? [[z0 - 10, z0], [z1, z0 - 30]] : [[z1, z0]]
    if (pit(k)) { const g = new THREE.PlaneGeometry(HW * 2, 20).rotateX(-Math.PI / 2); triUV(g); const gap = mesh(g, w.body[dim], 0, -9, z0 - 20, false); gap.receiveShadow = false }
    for (const [za, zb] of pieces) {
      const len = zb - za, zm = (za + zb) / 2
      s.boxes.push({ min: new V(-HW, -4, za), max: new V(HW, 2, zb), dim, floor: true })
      const bodyGeo = new THREE.BoxGeometry(HW * 2, 3, len, 4, 1, Math.ceil(len / 5)); triUV(bodyGeo); mesh(bodyGeo, w.body[dim], 0, -3.1, zm, false)
      const top = new THREE.PlaneGeometry(HW * 2, len, 48, Math.ceil(len * 1.2)); top.rotateX(-Math.PI / 2)
      for (let n = 0; n < top.attributes.position.count; n++) top.attributes.position.setY(n, terrainY(top.attributes.position.getX(n), zm + top.attributes.position.getZ(n)))
      top.computeVertexNormals()
      const uv = top.attributes.uv; for (let n = 0; n < uv.count; n++) uv.setXY(n, uv.getX(n) * HW * 2 / 4, uv.getY(n) * len / 4)
      mesh(top, w.lane[dim], 0, 0.002, zm, false)
      const count = Math.round(len * HW * 2 * 40), g = new THREE.InstancedBufferGeometry()
      g.index = blade.index; for (const [name, a] of Object.entries(blade.attributes)) g.setAttribute(name, a); g.instanceCount = count; g.boundingSphere = new THREE.Sphere(new V(0, 0.4, zm), Math.hypot(HW, len / 2) + 2)
      const gm = grassMaterial(new THREE.Vector4(-HW, za, HW * 2, len), TINT[dim]); track(dim, gm); s.grass.push(gm)
      const gmesh = new THREE.Mesh(g, gm); gmesh.userData.dim = dim; add(gmesh, s.detail)
      const g2 = new THREE.InstancedBufferGeometry(); g2.index = blade.index; for (const [name, a] of Object.entries(blade.attributes)) g2.setAttribute(name, a); g2.instanceCount = Math.round(len * HW * 2 * 45); g2.boundingSphere = g.boundingSphere
      const gm2 = grassMaterial(new THREE.Vector4(-HW, za, HW * 2, len), TINT[dim], true); track(dim, gm2); s.grass.push(gm2)
      const under = new THREE.Mesh(g2, gm2); add(under, s.detail)
    }

    // cliffs
    for (const side of [-1, 1]) {
      let zz = z1
      while (zz < z0 - 1) {
        const id = pick("namaqualand_cliff_01", "namaqualand_cliff_02", "mountainside", "coastal_cliff_02"), m = w.models[id], sz = m.box.getSize(new V())
        const rot = sz.x > sz.z ? Math.PI / 2 : 0, long = Math.max(sz.x, sz.z), thick = Math.min(sz.x, sz.z)
        const sc = Math.min(SEG * 0.55 / long, 16 / sz.y), len = long * sc
        const cm = [mat4(side * (HW + 0.6 + thick * sc / 2), -1, zz + len / 2, rot + (side > 0 ? 0 : Math.PI), sc, sc * (0.9 + rng() * 0.3), sc)]
        s.trees.hi.push(...place(id, dim, cm, s.group)); s.trees.lo.push(...place(id + "_lo", dim, cm, s.group))
        zz += len * 0.85
      }
      blob(dim, side * (HW - 1.2), zc, 7, SEG * 1.1)
      s.boxes.push({ min: new V(side > 0 ? HW : -HW - 1, -3, z1), max: new V(side > 0 ? HW + 1 : -HW, 16, z0), dim })
    }

    // ground cover
    const spots = (n: number) => [...Array(n)].map(() => { const x = (rng() - 0.5) * (HW * 2 - 2), z = z1 + rng() * SEG; return new V(x, terrainY(x, z), z) }).filter(p => onFloor(p.x, p.z))
    const scatter = (id: string, n: number, lo: number, hi: number) => place(id, dim, spots(n).map(p => mat4(p.x, p.y, p.z, rng() * 6.28, lo + rng() * (hi - lo))), s.detail, false)
    scatter("fern_02", 12, 0.7, 1.4); scatter("dandelion_01", 30, 0.8, 1.3); scatter("celandine_01", 70, 0.8, 1.5); scatter("periwinkle_plant", 14, 0.8, 1.3)
    scatter("grass_medium_01", 70, 0.8, 1.6); scatter("grass_medium_02", 60, 0.8, 1.6); scatter("moss_01", 20, 0.8, 1.6)
    scatter("shrub_02", 8, 0.9, 1.7); scatter("shrub_03", 5, 0.9, 1.6); scatter("dry_branches_medium_01", 2, 0.6, 1.1); scatter("tree_stump_01", 1, 0.8, 1.3)
    place(pick("namaqualand_boulder_02", "namaqualand_boulder_04"), dim, spots(8).map(p => mat4(p.x, p.y - 0.05, p.z, rng() * 6.28, 0.12 + rng() * 0.3)), s.detail, false)

    if (k > 0.6) for (let j = 0; j < 3; j++) {
      const id = pick("namaqualand_boulder_03", "namaqualand_boulder_05", "boulder_01"), m = w.models[id], sz = m.box.getSize(new V())
      const x = -HW + 4 + rng() * (HW * 2 - 8), z = z1 + 3 + rng() * (SEG - 6), h = 4 + rng() * 5, sc = h / sz.y, half = Math.max(0.8, Math.min(sz.x, sz.z) * sc * 0.3)
      const ty = terrainY(x, z)
      place(id, dim, [mat4(x, ty - 0.2, z, rng() * 6.28, sc * 0.75, sc, sc * 0.75)], s.group); blob(dim, x, z, half * 6, half * 6)
      s.boxes.push({ min: new V(x - half, ty - 0.6, z - half), max: new V(x + half, ty + h * 0.92, z + half), dim })
    }
    if (rng() < 0.6) {
      const x = (rng() - 0.5) * 16, y = 3 + rng() * 4, z = z1 + 3 + rng() * (SEG - 6), id = pick("namaqualand_boulder_03", "namaqualand_boulder_05"), sz = w.models[id].box.getSize(new V())
      s.boxes.push({ min: new V(x - 2.1, y, z - 2.1), max: new V(x + 2.1, y + 0.5, z + 2.1), dim })
      place(id, dim, [mat4(x, y + 0.5 - 1.6, z, rng() * 6.28, 5.4 / Math.max(sz.x, sz.z), 1.6 / sz.y, 5.4 / Math.max(sz.x, sz.z))], s.group)
      const cap = new THREE.CircleGeometry(2.6, 24); cap.rotateX(-Math.PI / 2); mesh(cap, w.lane[dim], x, y + 0.5, z, false)
    }
    if (k > 0.35 && k <= 0.6) {
      const pos = new V((rng() - 0.5) * (HW * 2 - 8), 0, z1 + 5 + rng() * (SEG - 10)), wk = walker(w.foe, dim)
      pos.y = terrainY(pos.x, pos.z); wk.mesh.position.set(pos.x, pos.y, pos.z); s.group.add(wk.mesh); blob(dim, 0, 0, 5.5, 5.5, wk.mesh)
      s.enemies.push({ mesh: wk.mesh, update: wk.update, turret: wk.turret, pos, dim, hp: 12, fireT: 1 + rng(), hitT: 0 })
    }
  }

  // hills with trees behind the cliffs, shared by every dimension
  for (const side of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(90, SEG, 45, 20); geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position, uv = geo.attributes.uv, rockW: number[] = []
    for (let n = 0; n < p.count; n++) {
      const wx = side * (HW + p.getX(n) + 45), wz = zc + p.getZ(n)
      p.setXYZ(n, wx, hillY(wx, wz), wz); uv.setXY(n, wx / 6, wz / 6)
    }
    geo.computeVertexNormals()
    const nrm = geo.attributes.normal
    for (let n = 0; n < p.count; n++) rockW.push(Math.min(1, Math.max(0, (1 - nrm.getY(n) - 0.2) * 4 + (fbm(p.getX(n) * 0.1, p.getZ(n) * 0.1, 3) - 0.62))))
    geo.setAttribute("aRock", new THREE.Float32BufferAttribute(rockW, 1))
    mesh(geo, w.hill, 0, 0, 0, false)
    for (const [hi, lo] of [["namaqualand_cliff_01_lo", "namaqualand_cliff_02_lo", "mountainside_lo", "coastal_cliff_02_lo", "fir_sapling", "fir_sapling_lo"], ["pine_sapling_small", "pine_sapling_lo"], ["fir_sapling_medium", "fir_sapling_medium_lo"]]) {
      const ms = [...Array(10)].map(() => {
        const wx = side * (HW + 16 + rng() * 70), wz = zc + (rng() - 0.5) * SEG, sz = w.models[hi].box.getSize(new V()), sc = (10 + rng() * 9) / sz.y
        return mat4(wx, hillY(wx, wz) - 0.3, wz, rng() * 6.28, sc)
      })
      for (const [id, list] of [[hi, s.trees.hi], [lo, s.trees.lo]] as const) for (const im of place(id, 0, ms, s.group)) {
        const mats = Array.isArray(im.material) ? im.material : [im.material]; mats.forEach(m => untrack(0, [m])); list.push(im)
      }
    }
  }
  return s
}

export const disposeSegment = (s: Seg) => {
  s.group.removeFromParent()
  s.geos.forEach(g => g.dispose())
  for (let d = 0; d < N; d++) untrack(d, s.grass)
}
