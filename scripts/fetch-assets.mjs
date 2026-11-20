// Downloads CC0 assets from Poly Haven (https://polyhaven.com) into public/assets and simplifies the models.
// Usage: node scripts/fetch-assets.mjs   (needs @gltf-transform/cli: npm i -D @gltf-transform/cli)
import fs from "fs"
import path from "path"
import { execFileSync } from "child_process"

const OUT = "public/assets", RAW = "/tmp/ph-raw"
const api = async p => (await fetch("https://api.polyhaven.com" + p)).json()
const get = async (url, file) => {
  if (fs.existsSync(file)) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`)
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}

const textures = { aerial_grass_rock: "2k", leafy_grass: "2k", rock_face: "2k", cliff_side: "2k", green_metal_rust: "2k", rusty_metal_02: "1k", metal_plate: "1k", forrest_ground_01: "2k", dry_ground_rocks: "1k" }
const hdris = { kloofendal_48d_partly_cloudy_puresky: "2k" }
const models = { boulder_01: 9000, namaqualand_boulder_02: 9000, namaqualand_boulder_03: 9000, namaqualand_boulder_04: 9000, namaqualand_boulder_05: 9000,
  namaqualand_cliff_01: 40000, namaqualand_cliff_02: 40000, mountainside: 40000, coastal_cliff_02: 40000, fir_sapling: 8000, pine_sapling_small: 8000, fir_sapling_medium: 10000,
  shrub_03: 0, shrub_02: 8000, fern_02: 0, dandelion_01: 4000, celandine_01: 6000, periwinkle_plant: 6000, grass_medium_01: 6000, grass_medium_02: 6000, moss_01: 6000,
  dry_branches_medium_01: 0, dead_tree_trunk: 12000, tree_stump_01: 10000 }

const lods = { namaqualand_cliff_01: 4000, namaqualand_cliff_02: 4000, mountainside: 4000, coastal_cliff_02: 4000, fir_sapling: 1500, pine_sapling_small: 1500, fir_sapling_medium: 1800 }

for (const [id, res] of Object.entries(textures)) {
  const f = await api(`/files/${id}`)
  for (const [map, key] of [["diff", "Diffuse"], ["nor", "nor_gl"], ["arm", "arm"]]) {
    await get(f[key][res].jpg.url, `${OUT}/tex/${id}_${map}.jpg`)
  }
}
for (const [id, res] of Object.entries(hdris)) await get((await api(`/files/${id}`)).hdri[res].hdr.url, `${OUT}/${id}.hdr`)

const info = await api("/assets?t=models")
for (const [id, target] of Object.entries(models)) {
  const g = (await api(`/files/${id}`)).gltf["1k"].gltf, dir = `${RAW}/${id}`
  await get(g.url, `${dir}/${id}.gltf`)
  for (const [rel, f] of Object.entries(g.include)) await get(f.url, `${dir}/${rel}`)
  const ratio = target ? Math.min(1, target / info[id].polycount) : 1
  const out = `${OUT}/models/${id}.glb`
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const bin = "node_modules/.bin/gltf-transform"
  if (ratio < 1) execFileSync(bin, ["simplify", `${dir}/${id}.gltf`, `${RAW}/${id}.s.glb`, "--ratio", String(ratio), "--error", "0.05"], { stdio: "inherit" })
  else execFileSync(bin, ["copy", `${dir}/${id}.gltf`, `${RAW}/${id}.s.glb`], { stdio: "inherit" })
  execFileSync(bin, ["optimize", `${RAW}/${id}.s.glb`, out, "--compress", "false", "--texture-compress", "false", "--simplify", "false"], { stdio: "inherit" })
  console.log(id, fs.statSync(out).size >> 10, "KB")
  if (lods[id]) {
    execFileSync(bin, ["simplify", `${dir}/${id}.gltf`, `${RAW}/${id}.lo.glb`, "--ratio", String(lods[id] / info[id].polycount), "--error", "0.2"], { stdio: "inherit" })
    execFileSync(bin, ["optimize", `${RAW}/${id}.lo.glb`, `${OUT}/models/${id}_lo.glb`, "--compress", "false", "--texture-compress", "false", "--simplify", "false"], { stdio: "inherit" })
  }
}
