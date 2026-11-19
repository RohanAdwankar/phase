import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"

const V = THREE.Vector3
export const N = 5
export type Mat = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
export type FoeMats = { olive: Mat[]; yellow: Mat[]; metal: Mat[]; lamp: Mat[] }
export type Enemy = { mesh: THREE.Group; legs: THREE.Group[]; turret: THREE.Object3D; pos: THREE.Vector3; dim: number; hp: number; fireT: number }

const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, r)
const per = <T,>(f: () => T) => [...Array(N)].map(f)
const std = (color: number, metalness: number, roughness: number) => () =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, transparent: true })

export const makeFoeMats = (): FoeMats => ({
  olive: per(std(0x5f6b38, 0.45, 0.5)), yellow: per(std(0xd8b822, 0.3, 0.45)), metal: per(std(0x3a3d3f, 0.9, 0.38)),
  lamp: per(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a1a).multiplyScalar(4), toneMapped: false, transparent: true })),
})

export const walker = (m: FoeMats, dim: number) => {
  const g = new THREE.Group(), legs: THREE.Group[] = []
  const part = (geo: THREE.BufferGeometry, mat: Mat, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh
  }
  const body = part(new THREE.SphereGeometry(1, 32, 20), m.olive[dim], 0, 1.55, 0)
  body.scale.set(1.05, 0.62, 1.15)
  for (const z of [-0.45, 0.2, 0.62]) {
    const r = Math.sqrt(Math.max(0, 1 - (z / 1.15) ** 2))
    const ring = part(new THREE.TorusGeometry(r + 0.01, 0.055, 8, 48), m.yellow[dim], 0, 1.55, z)
    ring.scale.set(1.05, 0.62, 1)
  }
  part(rbox(1.7, 0.16, 1.9, 0.06), m.metal[dim], 0, 1.02, 0)
  const hatch = part(new THREE.SphereGeometry(0.55, 24, 16), m.olive[dim], 0, 1.98, 0.05); hatch.scale.y = 0.6
  const turret = part(new THREE.SphereGeometry(0.34, 24, 16), m.metal[dim], 0, 2.3, -0.05)
  for (const x of [-0.12, 0.12]) { const b = part(new THREE.CylinderGeometry(0.05, 0.055, 0.9, 10), m.metal[dim], x, 2.3, -0.6); b.rotation.x = Math.PI / 2 }
  part(new THREE.SphereGeometry(0.075, 12, 8), m.lamp[dim], 0, 2.32, -0.37)
  for (const [x, y, z] of [[-0.55, 1.6, -1.04], [0.55, 1.6, -1.04], [-0.92, 1.5, 0.3], [0.92, 1.5, 0.3], [0, 1.35, 1.1]]) part(new THREE.SphereGeometry(0.065, 10, 8), m.lamp[dim], x, y, z)
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const hip = new THREE.Group(); hip.position.set(sx * 0.8, 1.45, sz * 0.6); g.add(hip)
    const up = new THREE.Group(); up.rotation.z = sx * 1.05; hip.add(up)
    part(new THREE.SphereGeometry(0.2, 16, 12), m.olive[dim], 0, 0, 0, up)
    part(new THREE.CylinderGeometry(0.14, 0.1, 1.1, 10), m.olive[dim], 0, -0.55, 0, up)
    part(new THREE.SphereGeometry(0.13, 12, 10), m.metal[dim], 0, -1.1, 0, up)
    const low = new THREE.Group(); low.position.y = -1.1; low.rotation.z = -sx * 1.55; up.add(low)
    part(new THREE.CylinderGeometry(0.11, 0.07, 1.35, 10), m.olive[dim], 0, -0.67, 0, low)
    part(new THREE.CylinderGeometry(0.115, 0.12, 0.28, 10), m.yellow[dim], 0, -0.12, 0, low)
    part(new THREE.CylinderGeometry(0.16, 0.2, 0.1, 12), m.metal[dim], 0, -1.38, 0, low)
    legs.push(hip)
  }
  return { mesh: g, legs, turret }
}

export const makeViewmodel = (flashMap: THREE.Texture) => {
  const root = new THREE.Group()
  const gun = new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.9, roughness: 0.35 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xc2ab72, metalness: 0.95, roughness: 0.28 })
  const grey = new THREE.MeshStandardMaterial({ color: 0x8d9296, metalness: 0.9, roughness: 0.32 })
  const suit = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.2, roughness: 0.7 })
  const orange = new THREE.MeshStandardMaterial({ color: 0xd9531a, metalness: 0.6, roughness: 0.35 })
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a10).multiplyScalar(3), toneMapped: false })
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); root.add(mesh); return mesh
  }
  const X = Math.PI / 2
  add(rbox(0.07, 0.095, 0.38, 0.015), gun, 0, 0, 0)
  add(rbox(0.05, 0.018, 0.32, 0.006), gold, 0, 0.056, -0.02)
  add(rbox(0.073, 0.03, 0.2, 0.01), orange, 0, 0.012, -0.12)
  add(rbox(0.075, 0.008, 0.14, 0.003), glow, 0, -0.012, -0.12)
  add(new THREE.CylinderGeometry(0.024, 0.026, 0.32, 12), gun, 0, 0.012, -0.34, X)
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 12), gold, 0, 0.012, -0.5, X)
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8), grey, 0, 0.03, -0.36, X)
  add(rbox(0.04, 0.15, 0.075, 0.01), gun, 0, -0.12, 0.05, 0.12)
  add(rbox(0.04, 0.1, 0.05, 0.01), gun, 0, -0.085, 0.18, -0.35)
  add(rbox(0.045, 0.085, 0.17, 0.012), gun, 0, -0.01, 0.27)
  add(rbox(0.03, 0.028, 0.045, 0.006), gun, 0, 0.082, 0.02)
  add(new THREE.SphereGeometry(0.008, 8, 8), glow, 0, 0.088, -0.0)
  const limb = (from: THREE.Vector3, to: THREE.Vector3, r: number, mat: THREE.Material) => {
    const len = from.distanceTo(to), dir = to.clone().sub(from).normalize()
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat)
    mesh.position.copy(from).lerp(to, 0.5); mesh.quaternion.setFromUnitVectors(new V(0, 1, 0), dir); root.add(mesh); return { dir, mesh }
  }
  const arm = (elbow: THREE.Vector3, wrist: THREE.Vector3, grip: number[]) => {
    const { dir } = limb(elbow, wrist, 0.032, suit)
    const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, -1), dir)
    for (const [t, w, h, mat] of [[0.25, 0.085, 0.14, gold], [0.62, 0.075, 0.09, grey], [0.5, 0.08, 0.025, orange]] as const) {
      const plate = new THREE.Mesh(rbox(w, w * 0.9, h, 0.02), mat); plate.position.copy(elbow).lerp(wrist, t); plate.quaternion.copy(q); root.add(plate)
    }
    const hand = new THREE.Mesh(rbox(0.078, 0.07, 0.11, 0.025), gold); hand.position.copy(wrist).addScaledVector(dir, 0.02); hand.quaternion.copy(q); root.add(hand)
    for (const z of grip) add(new THREE.CapsuleGeometry(0.011, 0.045, 4, 8), suit, wrist.x - 0.03, wrist.y - 0.0, z, 0, 0, X)
  }
  arm(new V(0.2, -0.34, 0.6), new V(0.0, -0.085, 0.19), [0.15, 0.185, 0.215])
  arm(new V(-0.24, -0.32, 0.36), new V(-0.0, -0.045, -0.2), [-0.18, -0.215, -0.25])
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.54); root.add(muzzle)
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0 }))
  flash.scale.setScalar(0.4); muzzle.add(flash)
  const light = new THREE.PointLight(0xff9a3a, 0, 8); muzzle.add(light)
  root.scale.setScalar(0.8); root.position.set(0.14, -0.15, -0.34)
  return { root, muzzle, flash, light, eject: new V(0.045, 0.03, 0.0) }
}
