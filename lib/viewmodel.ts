import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { PBR } from "./assets"
import { pbrMaterial } from "./materials"

const V = THREE.Vector3
const rbox = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, r)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const makeViewmodel = (armor: PBR) => {
  const root = new THREE.Group()
  const trimNormal = armor.normalMap.clone(); trimNormal.repeat.set(0.4, 0.4); trimNormal.needsUpdate = true
  const gold = new THREE.MeshStandardMaterial({ color: 0xcfb273, metalness: 0.8, roughness: 0.5, normalMap: trimNormal, normalScale: new THREE.Vector2(0.25, 0.25) })
  const grey = new THREE.MeshStandardMaterial({ color: 0x9ba1a9, metalness: 0.85, roughness: 0.5, normalMap: trimNormal, normalScale: new THREE.Vector2(0.25, 0.25) })
  const suit = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.82, metalness: 0.1, normalMap: armor.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) })
  const orange = new THREE.MeshStandardMaterial({ color: 0xe0561a, roughness: 0.4, metalness: 0.4 })
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a10).multiplyScalar(1.6), toneMapped: false })

  const size = new V(0.3, 0.14, 0.05)
  const top = size.y * 0.5, bottom = -top, gz0 = 0

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: THREE.Vector3, q?: THREE.Quaternion) => {
    const m = new THREE.Mesh(geo, mat); m.position.copy(p); if (q) m.quaternion.copy(q); root.add(m); return m
  }
  const align = (dir: THREE.Vector3, axis = new V(0, 1, 0)) => new THREE.Quaternion().setFromUnitVectors(axis, dir.clone().normalize())

  // a tapered tube following a curve, built from cone segments with ball joints so bends stay smooth
  const tube = (curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, mat: THREE.Material) => {
    const n = 14
    for (let i = 0; i < n; i++) {
      const a = curve.getPoint(i / n), b = curve.getPoint((i + 1) / n), r = lerp(r0, r1, i / n), r2 = lerp(r0, r1, (i + 1) / n)
      add(new THREE.CylinderGeometry(r2, r, a.distanceTo(b) * 1.03, 16), mat, a.clone().lerp(b, 0.5), align(b.clone().sub(a)))
      add(new THREE.SphereGeometry(r, 14, 10), mat, a)
    }
  }
  // curved armour plate wrapped around the limb: a partial cylinder facing away from the body
  const plate = (curve: THREE.Curve<THREE.Vector3>, t: number, span: number, r: number, mat: THREE.Material, wrap = 2.5, offset = 0) => {
    const p = curve.getPoint(t), tan = curve.getTangent(t), up = new V(0, 1, 0).sub(tan.clone().multiplyScalar(tan.y)).normalize()
    const geo = new THREE.CylinderGeometry(r, r * 0.94, span, 24, 1, true, Math.PI / 2 - wrap / 2 + offset, wrap)
    const m = add(geo, mat, p, align(tan)); const faceUp = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, 1).applyQuaternion(m.quaternion), up)
    m.quaternion.premultiply(faceUp)
  }
  const ring = (curve: THREE.Curve<THREE.Vector3>, t: number, r: number, mat: THREE.Material) => {
    const p = curve.getPoint(t); add(new THREE.TorusGeometry(r, 0.005, 8, 28), mat, p, align(curve.getTangent(t), new V(0, 0, 1)))
  }

  // segmented armoured sleeve: bevelled collars of alternating gold and grey separated by flexible dark undersuit, with a glowing seam
  const arm = (pts: THREE.Vector3[], wristR: number, elbowR: number) => {
    const c = new THREE.CatmullRomCurve3(pts)
    tube(c, wristR, elbowR, suit)
    ;[0.12, 0.34, 0.56, 0.78].forEach((t, k) => {
      const r = lerp(wristR, elbowR, t) + 0.0035, l = k === 0 ? 0.03 : 0.022, mat = k % 2 ? grey : gold, q = align(c.getTangent(t))
      add(new THREE.CylinderGeometry(r, r + 0.006, l, 28), mat, c.getPoint(t), q)
      for (const s of [-1, 1]) add(new THREE.TorusGeometry(r + 0.002, 0.0055, 8, 28), mat, c.getPoint(t).addScaledVector(c.getTangent(t), s * l * 0.5), align(c.getTangent(t), new V(0, 0, 1)))
      add(new THREE.TorusGeometry(r + 0.0035, 0.0028, 6, 28), glow, c.getPoint(t + 0.045).clone(), align(c.getTangent(t), new V(0, 0, 1)))
    })
  }

  // fingers wrap around the grip along an ellipse in the horizontal plane
  const gx = 0, gz = 0.03, rx = 0.027, rz = 0.04
  const finger = (y: number, a0: number, a1: number, scale: number, r: number, mat: THREE.Material) => {
    const pts = [0, 1, 2, 3].map(k => { const a = lerp(a0, a1, k / 3); return new V(gx + Math.sin(a) * rx * scale, y, gz + Math.cos(a) * rz * scale) })
    pts.forEach((p, k) => {
      add(new THREE.SphereGeometry(r * (1 - k * 0.06), 12, 10), mat, p)
      if (k && k < 3) add(new THREE.TorusGeometry(r * 0.98, 0.0032, 6, 16), grey, p.clone().lerp(pts[k - 1], 0.25), align(p.clone().sub(pts[k - 1]), new V(0, 0, 1)))
      if (k) add(new THREE.CylinderGeometry(r * (1 - k * 0.06), r * (1.04 - k * 0.06), p.distanceTo(pts[k - 1]), 12), mat, p.clone().lerp(pts[k - 1], 0.5), align(p.clone().sub(pts[k - 1])))
    })
  }
  const limbChain = (pts: THREE.Vector3[], r: number, mat: THREE.Material) => pts.forEach((p, k) => {
    add(new THREE.SphereGeometry(r * (1 - k * 0.08), 12, 10), mat, p)
    if (k) add(new THREE.CylinderGeometry(r * (1 - k * 0.08), r * (1.05 - (k - 1) * 0.08), p.distanceTo(pts[k - 1]), 12), mat, p.clone().lerp(pts[k - 1], 0.5), align(p.clone().sub(pts[k - 1])))
  })

  // right hand: palm behind the grip, three fingers curled round the front, index along the frame, thumb on the far side
  const rad = Math.PI / 180
  const rightY = [top * -0.1, bottom * 0.35, bottom * 0.75]
  rightY.forEach(y => finger(y, 30 * rad, 215 * rad, 1, 0.0115, suit))
  add(rbox(0.05, size.y * 0.62, 0.052, 0.014), suit, new V(gx + 0.03, bottom * 0.4, gz + 0.045), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.35, 0)))
  add(rbox(0.012, size.y * 0.56, 0.055, 0.005), gold, new V(gx + 0.058, bottom * 0.4, gz + 0.046), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.35, 0)))
  for (const y of rightY) add(rbox(0.014, 0.017, 0.022, 0.004), grey, new V(gx + 0.043, y, gz + 0.075))
  limbChain([new V(gx + 0.022, top * 0.08, gz + 0.062), new V(gx - 0.026, top * 0.12, gz + 0.03), new V(gx - 0.034, top * 0.2, gz - 0.02), new V(gx - 0.03, top * 0.18, gz - 0.055)], 0.0125, suit)
  limbChain([new V(gx + 0.032, top * 0.3, gz + 0.04), new V(gx + 0.034, top * 0.28, gz - 0.02), new V(gx + 0.03, top * 0.2, gz - 0.07)], 0.0105, suit)
  arm([new V(gx + 0.052, bottom * 0.2, gz + 0.1), new V(gx + 0.085, bottom * 0.7, gz + 0.22), new V(gx + 0.1, bottom * 2.6, gz + 0.4), new V(gx + 0.13, -0.42, gz + 0.72)], 0.017, 0.026)

  // recurve bow: a riser at the hand, two limbs that curve toward the archer, and a string between the tips
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.55, metalness: 0.05, normalMap: armor.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) })
  const stringMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.9 })
  const LIMB = 0.27, TIPZ = 0.12
  add(rbox(0.026, 0.19, 0.045, 0.01), wood, new V(0, 0.01, -0.012))
  add(rbox(0.03, 0.05, 0.05, 0.01), gold, new V(0, 0.095, -0.012)); add(rbox(0.03, 0.05, 0.05, 0.01), gold, new V(0, -0.075, -0.012))
  const limbs: THREE.Group[] = []
  for (const s of [1, -1]) {
    const g = new THREE.Group(); g.position.set(0, s * 0.11, 0); root.add(g)
    const c = new THREE.CatmullRomCurve3([new V(0, 0, 0), new V(0, s * 0.07, 0.004), new V(0, s * 0.16, 0.03), new V(0, s * LIMB, TIPZ)])
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.0105, 10), wood))
    for (const t of [0.15, 0.5, 0.85]) { const q = c.getPoint(t); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.003, 6, 14), gold); ring.position.copy(q); ring.quaternion.copy(align(c.getTangent(t), new V(0, 0, 1))); g.add(ring) }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 10, 8), gold); tip.position.set(0, s * LIMB, TIPZ); g.add(tip)
    limbs.push(g)
  }
  const tipY = 0.11 + LIMB, strAt = new V(0, 0, TIPZ + 0.01)
  const strings = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 1, 6), stringMat); root.add(m); return m })
  const setCyl = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => { m.position.copy(a).lerp(b, 0.5); m.scale.set(1, a.distanceTo(b), 1); m.quaternion.copy(align(b.clone().sub(a))) }
  // the arrow rests on the riser; its nock follows the string
  const arrow = new THREE.Group(); root.add(arrow)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.62, 8), new THREE.MeshStandardMaterial({ color: 0xc9a56a, roughness: 0.6 })); shaft.rotation.x = Math.PI / 2; shaft.position.z = -0.31; arrow.add(shaft)
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.0085, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.25 })); head.rotation.x = -Math.PI / 2; head.position.z = -0.645; arrow.add(head)
  for (const a of [0, 2.09, 4.19]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.022, 0.07), new THREE.MeshStandardMaterial({ color: a ? 0xe8e0d0 : 0xd9531a, roughness: 0.8, side: THREE.DoubleSide })); f.position.set(Math.sin(a) * 0.011, Math.cos(a) * 0.011, -0.05); f.rotation.z = -a; arrow.add(f) }

  // drawing hand and forearm, positioned at the nock
  const drawHand = new THREE.Group(); root.add(drawHand)
  const dh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); drawHand.add(m); return m }
  dh(rbox(0.05, 0.034, 0.07, 0.014), suit, 0, -0.012, 0.05)
  dh(rbox(0.052, 0.012, 0.06, 0.005), gold, 0, 0.012, 0.05)
  for (const x of [-0.016, 0, 0.016]) { dh(new THREE.CapsuleGeometry(0.0095, 0.036, 4, 8), suit, x, -0.006, 0.0, Math.PI / 2, 0, 0); dh(new THREE.CapsuleGeometry(0.0088, 0.028, 4, 8), suit, x, -0.02, -0.003, 0, 0, Math.PI / 2 * 0).rotation.x = 0.4 }
  dh(new THREE.CapsuleGeometry(0.0095, 0.03, 4, 8), suit, 0.03, 0.002, 0.03, 0, 0, 0.6)
  const forearm = new THREE.CatmullRomCurve3([new V(0, -0.012, 0.09), new V(-0.03, -0.045, 0.2), new V(-0.1, -0.12, 0.38), new V(-0.2, -0.26, 0.62)])
  const ft = new THREE.Group(); drawHand.add(ft)
  {
    ;[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].forEach(i => { const a = forearm.getPoint(i / 14), b = forearm.getPoint((i + 1) / 14), r = lerp(0.017, 0.026, i / 14); const cy = new THREE.Mesh(new THREE.CylinderGeometry(lerp(0.017, 0.026, (i + 1) / 14), r, a.distanceTo(b) * 1.03, 14), suit); cy.position.copy(a).lerp(b, 0.5); cy.quaternion.copy(align(b.clone().sub(a))); ft.add(cy); const bl = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), suit); bl.position.copy(a); ft.add(bl) })
    ;[0.2, 0.5, 0.8].forEach((t, k) => { const r = lerp(0.017, 0.026, t) + 0.004, c = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.004, k ? 0.03 : 0.04, 22), k % 2 ? grey : gold); c.position.copy(forearm.getPoint(t)); c.quaternion.copy(align(forearm.getTangent(t))); ft.add(c) })
  }

  let drawAmt = 0
  const setDraw = (f: number, nocked: boolean) => {
    drawAmt = f
    const pull = 0.29 * f, mid = new V(0, 0, strAt.z + pull)
    limbs[0].rotation.x = 0.13 * f; limbs[1].rotation.x = -0.13 * f
    const tipZ = TIPZ - Math.sin(0.13 * f) * LIMB * 0.9
    setCyl(strings[0], new V(0, tipY - (1 - Math.cos(0.13 * f)) * 0.0, tipZ), mid)
    setCyl(strings[1], new V(0, -tipY + (1 - Math.cos(0.13 * f)) * 0.0, tipZ), mid)
    arrow.visible = nocked; arrow.position.set(0, 0.012, mid.z)
    drawHand.visible = f > 0.02 || nocked; drawHand.position.set(0, 0.0, mid.z)
  }
  setDraw(0, true)
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.5); root.add(muzzle)
  root.scale.setScalar(1.4); root.position.set(0.14, -0.2, -0.7)
  return { root, muzzle, setDraw, tipY, get draw() { return drawAmt } }

}
