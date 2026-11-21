import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { PBR } from "./assets"
import { track, pbrMaterial, terrainY } from "./materials"

const V = THREE.Vector3
const N = 5
export type Mat = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
export type FoeMats = { olive: Mat[]; yellow: Mat[]; metal: Mat[]; lamp: Mat[] }
export type Kind = "walker" | "swarmer" | "flyer" | "brute" | "boss" | "guardian"
// r is the body radius used for pushing units apart and out of rock, hr the radius of the hit box, h its height, fy the hover height
export type Enemy = { kind: Kind; mesh: THREE.Group; update: (dt: number, moving: boolean, phase: number, slam?: number) => void; turret: THREE.Object3D; pos: THREE.Vector3; dim: number; hp: number; fireT: number; hitT: number
  r: number; hr: number; h: number; fy: number; speed: number; t1: number; t2: number; shiftT?: number; maxHp?: number; volT?: number; lv?: number; ghost?: THREE.Material[]; variant?: number; ai?: Record<string, number>; home?: { x: number; z: number } }
export const STATS: Record<Kind, { hp: number; r: number; hr: number; h: number; fy: number; speed: number }> = {
  walker: { hp: 12, r: 1.8, hr: 1.3, h: 3, fy: 0, speed: 2.5 },
  swarmer: { hp: 2, r: 0.7, hr: 0.75, h: 1.1, fy: 0, speed: 8.5 },
  flyer: { hp: 6, r: 1.3, hr: 1.2, h: 1.4, fy: 5, speed: 6 },
  brute: { hp: 45, r: 2.7, hr: 2.2, h: 4.4, fy: 0, speed: 3.4 },
  boss: { hp: 150, r: 4.6, hr: 3.8, h: 7.6, fy: 0, speed: 7.5 },
  guardian: { hp: 80, r: 3.5, hr: 3, h: 6.2, fy: 0, speed: 3.6 },
}

const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, r)
const per = <T,>(f: (i: number) => T) => [...Array(N)].map((_, i) => track(i, f(i) as unknown as THREE.Material) as unknown as T)
const tiled = (p: PBR, r: number): PBR => {
  const t = (x: THREE.Texture) => { const c = x.clone(); c.repeat.set(r, r); c.needsUpdate = true; return c }
  return { map: t(p.map), normalMap: t(p.normalMap), arm: t(p.arm) }
}

export const makeFoeMats = (olivePBR: PBR, metalPBR: PBR): FoeMats => {
  const olive = tiled(olivePBR, 2), metal = tiled(metalPBR, 2)
  const mats = {
    olive: per(() => pbrMaterial(olive, { metalness: 0.55, tint: 0xffffff })),
    yellow: per(() => new THREE.MeshStandardMaterial({ color: 0xf0c418, metalness: 0.4, roughness: 0.5, roughnessMap: olive.arm, normalMap: olive.normalMap, transparent: true })),
    metal: per(() => pbrMaterial(metal, { metalness: 0.75, tint: 0xd8dade })),
    lamp: per(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a1a).multiplyScalar(4), toneMapped: false, transparent: true })),
  }
  Object.values(mats).forEach(l => (l as THREE.Material[]).forEach(m => (m.userData.xray = true)))
  return mats
}

type Leg = { hip: THREE.Group; upper: THREE.Group; lower: THREE.Group; home: THREE.Vector3; foot: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number; side: number }
const L1 = 1.25, L2 = 1.5

export const walker = (m: FoeMats, dim: number) => {
  const g = new THREE.Group(), legs: Leg[] = []
  const part = (geo: THREE.BufferGeometry, mat: Mat, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh
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
      if (leg.t < 1) { leg.t = Math.min(1, leg.t + dt * 4); leg.foot.lerpVectors(leg.from, leg.to, leg.t); leg.foot.y = terrainY(leg.foot.x, leg.foot.z, dim) + Math.sin(leg.t * Math.PI) * 0.45 }
      else leg.foot.y = terrainY(leg.foot.x, leg.foot.z, dim)
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

const mk = (geo: THREE.BufferGeometry, mat: Mat, parent: THREE.Object3D, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m }

// small fast bug that rushes the player and bursts on contact
const swarmer = (m: FoeMats, dim: number) => {
  const g = new THREE.Group(), legs: THREE.Mesh[] = []
  const body = mk(new THREE.SphereGeometry(0.5, 14, 10), m.olive[dim], g, 0, 0.55, 0); body.scale.set(1, 0.72, 1.25)
  mk(new THREE.SphereGeometry(0.34, 12, 9), m.yellow[dim], g, 0, 0.78, -0.4).scale.set(1, 0.8, 1)
  for (const x of [-0.14, 0.14]) mk(new THREE.SphereGeometry(0.075, 8, 6), m.lamp[dim], g, x, 0.86, -0.68)
  mk(new THREE.ConeGeometry(0.2, 0.55, 6), m.yellow[dim], g, 0, 0.62, 0.62).rotation.x = Math.PI / 2
  for (const [sx, sz] of [[-1, -0.3], [1, -0.3], [-1, 0.2], [1, 0.2]]) { const l = mk(new THREE.CylinderGeometry(0.05, 0.04, 0.6, 5), m.metal[dim], g, sx * 0.5, 0.28, sz); l.rotation.z = sx * 0.7; legs.push(l) }
  const update = (_dt: number, moving: boolean, phase: number) => { legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(phase * 3.2 + i * 1.7) * 0.7 : 0)); body.position.y = 0.55 + (moving ? Math.abs(Math.sin(phase * 3.2)) * 0.08 : 0) }
  return { mesh: g, turret: body, update }
}

// hovering drone: disc body, glowing underside, three spinning rotors; it circles and shoots
const flyer = (m: FoeMats, dim: number) => {
  const g = new THREE.Group(), rotors: THREE.Mesh[] = []
  const body = mk(new THREE.SphereGeometry(0.85, 18, 12), m.metal[dim], g, 0, 0.7, 0); body.scale.set(1.15, 0.5, 1.15)
  mk(new THREE.SphereGeometry(0.5, 14, 10), m.yellow[dim], g, 0, 0.98, 0).scale.set(1, 0.6, 1)
  mk(new THREE.TorusGeometry(0.72, 0.07, 6, 24), m.lamp[dim], g, 0, 0.5, 0).rotation.x = Math.PI / 2
  mk(new THREE.SphereGeometry(0.14, 8, 6), m.lamp[dim], g, 0, 0.55, -0.9)
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094, arm = new THREE.Group(); arm.position.set(Math.cos(a) * 0.95, 0.85, Math.sin(a) * 0.95); g.add(arm)
    mk(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), m.metal[dim], arm, 0, -0.1, 0)
    const rot = mk(new THREE.BoxGeometry(1.25, 0.03, 0.14), m.yellow[dim], arm, 0, 0.1, 0); rotors.push(rot)
  }
  const update = (dt: number) => { rotors.forEach((r, i) => (r.rotation.y += dt * (28 + i * 3))) }
  return { mesh: g, turret: body, update }
}

// heavy melee brute: wide armoured torso, huge fists, slow but hits very hard
const brute = (m: FoeMats, dim: number) => {
  const g = new THREE.Group(), arms: THREE.Group[] = [], legs: THREE.Mesh[] = []
  mk(rbox(2.6, 2.1, 2.1, 0.25), m.olive[dim], g, 0, 2.55, 0)
  mk(rbox(2.9, 0.5, 2.3, 0.15), m.yellow[dim], g, 0, 3.55, 0)
  mk(rbox(1.0, 0.9, 1.0, 0.2), m.metal[dim], g, 0, 4.0, -0.35)
  mk(new THREE.BoxGeometry(0.9, 0.16, 0.1), m.lamp[dim], g, 0, 4.05, -0.88)
  for (const x of [-0.55, 0.55]) mk(rbox(0.9, 1.0, 1.2, 0.2), m.metal[dim], g, x, 1.45, 0)
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 1.9, 3.3, 0); g.add(arm)
    mk(rbox(0.9, 0.9, 0.9, 0.2), m.yellow[dim], arm, 0, 0, 0)
    mk(new THREE.CylinderGeometry(0.34, 0.3, 1.5, 8), m.metal[dim], arm, 0, -0.9, 0)
    mk(rbox(1.25, 1.15, 1.25, 0.25), m.olive[dim], arm, 0, -1.9, 0.1)
    arms.push(arm)
  }
  for (const s of [-1, 1]) legs.push(mk(new THREE.CylinderGeometry(0.34, 0.4, 1.5, 8), m.metal[dim], g, s * 0.8, 0.75, 0))
  const update = (_dt: number, moving: boolean, phase: number, slam = 0) => {
    arms.forEach((a, i) => (a.rotation.x = slam > 0 ? -2.3 + (1 - slam) * 2.6 : moving ? Math.sin(phase * 1.4 + i * Math.PI) * 0.35 : 0))
    legs.forEach((l, i) => (l.position.y = 0.75 + (moving ? Math.max(0, Math.sin(phase * 1.4 + i * Math.PI)) * 0.2 : 0)))
  }
  return { mesh: g, turret: g.children[2], update }
}

export const makeEnemy = (kind: Kind, m: FoeMats, dim: number, pos: THREE.Vector3): Enemy => {
  const s = STATS[kind], b = kind === "walker" ? walker(m, dim) : kind === "swarmer" ? swarmer(m, dim) : kind === "flyer" ? flyer(m, dim) : brute(m, dim)
  if (kind === "boss") b.mesh.scale.setScalar(1.72)
  if (kind === "guardian") b.mesh.scale.setScalar(1.4)
  return { kind, mesh: b.mesh, update: b.update as Enemy["update"], turret: b.turret, pos, dim, hp: s.hp, fireT: 0.8 + Math.random(), hitT: 0, r: s.r, hr: s.hr, h: s.h, fy: s.fy, speed: s.speed, t1: 0, t2: 0 }
}
