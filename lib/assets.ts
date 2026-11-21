import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

const A = (process.env.NEXT_PUBLIC_BASE ?? "") + "/assets"
export type Part = { geo: THREE.BufferGeometry; mat: THREE.Material }
export type Model = { parts: Part[]; box: THREE.Box3 }
export type PBR = { map: THREE.Texture; normalMap: THREE.Texture; arm: THREE.Texture }

const texLoader = new THREE.TextureLoader()
const load = (url: string, srgb: boolean) => texLoader.loadAsync(url).then(t => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t
})
export const loadPBR = async (id: string): Promise<PBR> => {
  const [map, normalMap, arm] = await Promise.all([load(`${A}/tex/${id}_diff.jpg`, true), load(`${A}/tex/${id}_nor.jpg`, false), load(`${A}/tex/${id}_arm.jpg`, false)])
  return { map, normalMap, arm }
}

// Loads a glb into world-space geometry parts sitting on y = 0, centered on x and z
export const loadModel = async (id: string): Promise<Model> => {
  const gltf = await new GLTFLoader().loadAsync(`${A}/models/${id}.glb`)
  gltf.scene.updateMatrixWorld(true)
  const parts: Part[] = [], box = new THREE.Box3()
  gltf.scene.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld)
    geo.computeBoundingBox(); box.union(geo.boundingBox!)
    parts.push({ geo, mat: m.material as THREE.Material })
  })
  const c = box.getCenter(new THREE.Vector3()), shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z)
  for (const p of parts) p.geo.applyMatrix4(shift)
  box.applyMatrix4(shift)
  return { parts, box }
}
