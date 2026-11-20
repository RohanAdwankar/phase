import * as THREE from "three"
import { fbm } from "./noise"

// Procedural boulders: a closed, thick, faceted blob (a displaced icosphere), never an open shell. The `slab` variant has a flat top for floating platforms.
const build = (seed: number, slab: boolean) => {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const k = 1 + (fbm(x * 1.3 + seed, y * 1.3, z * 1.3 + seed * 0.7, 3) - 0.5) * 0.75
    let yy = y * k
    if (yy < -0.55) yy = -0.55 + (yy + 0.55) * 0.15
    if (slab && yy > 0.6) yy = 0.6
    p.setXYZ(i, x * k, yy, z * k)
  }
  g.computeVertexNormals(); g.computeBoundingBox()
  // a quarter of a metre below the origin is flat, so boulders sit on terrain without floating
  return g.toNonIndexed()
}
export const BOULDERS = [0, 1, 2, 3].map(i => build(i * 7.3 + 1, false))
export const SLABS = [0, 1].map(i => build(i * 5.1 + 40, true))
