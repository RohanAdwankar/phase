import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { PBR } from "./assets"
import { track, pbrMaterial } from "./materials"

const V = THREE.Vector3
const N = 5
export type Mat = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
export type FoeMats = { olive: Mat[]; yellow: Mat[]; metal: Mat[]; lamp: Mat[] }
export type Enemy = { mesh: THREE.Group; update: (dt: number, moving: boolean, phase: number) => void; turret: THREE.Object3D; pos: THREE.Vector3; dim: number; hp: number; fireT: number }

const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, r)
const per = <T,>(f: (i: number) => T) => [...Array(N)].map((_, i) => track(i, f(i) as unknown as THREE.Material) as unknown as T)
const tiled = (p: PBR, r: number): PBR => {
  const t = (x: THREE.Texture) => { const c = x.clone(); c.repeat.set(r, r); c.needsUpdate = true; return c }
  return { map: t(p.map), normalMap: t(p.normalMap), arm: t(p.arm) }
}

export const makeFoeMats = (olivePBR: PBR, metalPBR: PBR): FoeMats => {
  const olive = tiled(olivePBR, 2), metal = tiled(metalPBR, 2)
  return {
    olive: per(() => pbrMaterial(olive, { metalness: 0.55, tint: 0xffffff })),
    yellow: per(() => new THREE.MeshStandardMaterial({ color: 0xf0c418, metalness: 0.4, roughness: 0.5, roughnessMap: olive.arm, normalMap: olive.normalMap, transparent: true })),
    metal: per(() => pbrMaterial(metal, { metalness: 0.75, tint: 0xd8dade })),
    lamp: per(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a1a).multiplyScalar(4), toneMapped: false, transparent: true })),
  }
}

type Leg = { hip: THREE.Group; upper: THREE.Group; lower: THREE.Group; home: THREE.Vector3; foot: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number; side: number }
const L1 = 1.25, L2 = 1.5

export const walker = (m: FoeMats, dim: number) => {
  const g = new THREE.Group(), legs: Leg[] = []
  const part = (geo: THREE.BufferGeometry, mat: Mat, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh
  }
  // armoured shell: a lathe profile gives a smooth dome with a lip instead of a bare sphere
  const shell = new THREE.LatheGeometry([[0.001, 0.62], [0.42, 0.6], [0.8, 0.5], [1.05, 0.28], [1.12, 0.05], [1.08, -0.05], [1.14, -0.12], [1.0, -0.2], [0.001, -0.22]].map(([x, y]) => new THREE.Vector2(x, y)), 48)
  const body = part(shell, m.olive[dim], 0, 1.7, 0); body.scale.set(1, 1, 1.12)
  part(new THREE.CylinderGeometry(1.08, 0.9, 0.22, 40), m.metal[dim], 0, 1.4, 0).scale.z = 1.12
  for (const [y, r, sz] of [[1.82, 0.9, 1.12], [1.62, 1.1, 1.12]] as const) { const t = part(new THREE.TorusGeometry(r, 0.03, 8, 64), m.metal[dim], 0, y, 0); t.rotation.x = Math.PI / 2; t.scale.set(1, sz, 1) }
  for (const a of [-0.55, 0.55]) { const band = part(new THREE.CylinderGeometry(1.0, 1.06, 0.2, 24, 1, true, a + Math.PI / 2 - 0.35, 0.7), m.yellow[dim], 0, 1.76, 0); band.scale.z = 1.12 }
  for (let k = 0; k < 28; k++) { const a = (k / 28) * 6.283, b = part(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), m.metal[dim], Math.cos(a) * 1.115, 1.72, Math.sin(a) * 1.115 * 1.12); b.rotation.set(Math.PI / 2, 0, -a + Math.PI / 2) }
  const hatch = part(new THREE.SphereGeometry(0.55, 28, 16), m.olive[dim], 0, 2.28, 0.1); hatch.scale.y = 0.5
  const turret = part(new THREE.SphereGeometry(0.36, 28, 20), m.metal[dim], 0, 2.5, -0.05)
  part(rbox(0.5, 0.26, 0.4, 0.08), m.olive[dim], 0, 2.42, -0.3)
  for (const x of [-0.13, 0.13]) {
    const b = part(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 12), m.metal[dim], x, 2.5, -0.8); b.rotation.x = Math.PI / 2
    const sh = part(new THREE.CylinderGeometry(0.085, 0.085, 0.4, 12), m.metal[dim], x, 2.5, -0.55); sh.rotation.x = Math.PI / 2
    const mz = part(new THREE.CylinderGeometry(0.075, 0.06, 0.12, 12), m.metal[dim], x, 2.5, -1.3); mz.rotation.x = Math.PI / 2
  }
  part(new THREE.SphereGeometry(0.075, 12, 8), m.lamp[dim], 0, 2.56, -0.4)
  for (const x of [-0.45, 0.45]) { part(new THREE.CylinderGeometry(0.1, 0.13, 0.7, 12), m.metal[dim], x, 2.2, 1.0); part(new THREE.SphereGeometry(0.1, 12, 8), m.lamp[dim], x, 2.58, 1.0) }
  for (const [x, y, z] of [[-0.6, 1.55, -1.12], [0.6, 1.55, -1.12], [-1.05, 1.5, 0.3], [1.05, 1.5, 0.3], [0, 1.45, 1.25]]) part(new THREE.SphereGeometry(0.06, 10, 8), m.lamp[dim], x, y, z)
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const hip = new THREE.Group(); hip.position.set(sx * 0.95, 1.55, sz * 0.7); g.add(hip)
    part(new THREE.SphereGeometry(0.24, 18, 14), m.olive[dim], 0, 0, 0, hip)
    const upper = new THREE.Group(); hip.add(upper)
    part(new THREE.CylinderGeometry(0.15, 0.11, L1, 12), m.olive[dim], 0, -L1 / 2, 0, upper)
    part(new THREE.CylinderGeometry(0.04, 0.04, L1 * 0.8, 8), m.metal[dim], 0.17 * sx, -L1 * 0.45, 0, upper)
    part(new THREE.SphereGeometry(0.16, 14, 12), m.metal[dim], 0, -L1, 0, upper)
    const lower = new THREE.Group(); lower.position.y = -L1; upper.add(lower)
    part(new THREE.CylinderGeometry(0.11, 0.07, L2, 12), m.metal[dim], 0, -L2 / 2, 0, lower)
    part(new THREE.CylinderGeometry(0.125, 0.13, 0.32, 12), m.yellow[dim], 0, -0.3, 0, lower)
    part(new THREE.CylinderGeometry(0.2, 0.26, 0.1, 14), m.metal[dim], 0, -L2, 0, lower)
    const home = new V(sx * 1.9, 0, sz * 1.3)
    legs.push({ hip, upper, lower, home, foot: home.clone(), from: home.clone(), to: home.clone(), t: 1, side: sx })
  }

  const world = new V(), local = new V(), down = new V(0, -1, 0)
  let ready = false
  const update = (dt: number, moving: boolean, phase: number) => {
    g.updateMatrixWorld(true)
    if (!ready) { ready = true; legs.forEach(l => { l.foot.copy(l.home).applyMatrix4(g.matrixWorld); l.from.copy(l.foot); l.to.copy(l.foot) }) }
    legs.forEach((leg, k) => {
      // step the foot to its home spot (in body space) once it trails too far behind, in a diagonal gait
      const hw = leg.home.clone().applyMatrix4(g.matrixWorld)
      if (leg.t >= 1 && moving && leg.foot.distanceTo(hw) > 0.9 && Math.sin(phase + (k === 0 || k === 3 ? 0 : Math.PI)) > 0) { leg.from.copy(leg.foot); leg.to.copy(hw).addScaledVector(hw.clone().sub(leg.foot).normalize(), 0.5); leg.t = 0 }
      if (leg.t < 1) { leg.t = Math.min(1, leg.t + dt * 4); leg.foot.lerpVectors(leg.from, leg.to, leg.t); leg.foot.y = Math.sin(leg.t * Math.PI) * 0.45 }
      else if (!moving) leg.foot.set(leg.foot.x, 0, leg.foot.z)
      // two-bone IK in body space: the knee bends up and away from the body
      local.copy(leg.foot); g.worldToLocal(local)
      const hip = leg.hip.position, d = local.clone().sub(hip), dist = Math.min(L1 + L2 - 0.02, Math.max(0.4, d.length())), dir = d.clone().normalize()
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
      const out = new V(leg.side, 0.9, 0).sub(dir.clone().multiplyScalar(new V(leg.side, 0.9, 0).dot(dir))).normalize()
      const knee = hip.clone().addScaledVector(dir, a).addScaledVector(out, h)
      leg.upper.quaternion.setFromUnitVectors(down, knee.clone().sub(hip).normalize())
      world.copy(local).sub(knee).applyQuaternion(leg.upper.quaternion.clone().invert())
      leg.lower.quaternion.setFromUnitVectors(down, world.normalize())
    })
  }
  return { mesh: g, turret, update }
}

export const makeViewmodel = (flashMap: THREE.Texture, pistol: { geo: THREE.BufferGeometry; mat: THREE.Material; box: THREE.Box3 }) => {
  const root = new THREE.Group()
  const gold = new THREE.MeshStandardMaterial({ color: 0xc2ab72, metalness: 0.95, roughness: 0.28 })
  const grey = new THREE.MeshStandardMaterial({ color: 0x8d9296, metalness: 0.9, roughness: 0.32 })
  const suit = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.2, roughness: 0.7 })
  const orange = new THREE.MeshStandardMaterial({ color: 0xd9531a, metalness: 0.6, roughness: 0.35 })

  // the pistol's barrel points along +x in the model; turn it to -z and centre the grip over the origin
  const size = pistol.box.getSize(new V()), gun = new THREE.Mesh(pistol.geo, pistol.mat)
  gun.rotation.y = Math.PI / 2; gun.position.set(0, -pistol.box.min.y - size.y * 0.5, pistol.box.min.x + 0.07)
  root.add(gun)
  const len = size.x

  const limb = (from: THREE.Vector3, to: THREE.Vector3, r: number, mat: THREE.Material) => {
    const l = from.distanceTo(to), dir = to.clone().sub(from).normalize()
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 6, 14), mat)
    mesh.position.copy(from).lerp(to, 0.5); mesh.quaternion.setFromUnitVectors(new V(0, 1, 0), dir); root.add(mesh); return dir
  }
  const arm = (elbow: THREE.Vector3, wrist: THREE.Vector3) => {
    const dir = limb(elbow, wrist, 0.03, suit), q = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, -1), dir)
    for (const [t, w, h, mat] of [[0.22, 0.08, 0.13, gold], [0.6, 0.07, 0.08, grey], [0.45, 0.075, 0.02, orange]] as const) {
      const plate = new THREE.Mesh(new RoundedBoxGeometry(w, w * 0.9, h, 3, 0.02), mat); plate.position.copy(elbow).lerp(wrist, t); plate.quaternion.copy(q); root.add(plate)
    }
    const hand = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.065, 0.1, 3, 0.025), gold); hand.position.copy(wrist).addScaledVector(dir, 0.02); hand.quaternion.copy(q); root.add(hand)
  }
  const grip = new V(0.0, -size.y * 0.25, 0.0)
  arm(new V(0.22, -0.34, 0.5), grip.clone().add(new V(0.02, 0.0, 0.0)))
  arm(new V(-0.26, -0.32, 0.3), new V(-0.02, -size.y * 0.45, -0.03))

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, size.y * 0.25, -len * 0.75); root.add(muzzle)
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0 }))
  flash.scale.setScalar(0.4); muzzle.add(flash)
  const light = new THREE.PointLight(0xff9a3a, 0, 8); muzzle.add(light)
  root.position.set(0.14, -0.13, -0.32)
  return { root, muzzle, flash, light, eject: new V(0.03, size.y * 0.3, -len * 0.1) }
}
