import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { PBR } from "./assets"
import { pbrMaterial } from "./materials"

const V = THREE.Vector3
const rbox = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, r)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const makeSword = (armor: PBR) => {
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


  // arming sword: a tapered double-edged blade with a fuller, a gold crossguard and a pommel, standing up from the fist
  const steel = new THREE.MeshStandardMaterial({ color: 0xd4d9df, metalness: 1, roughness: 0.18, envMapIntensity: 1.4 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x6b7480, metalness: 1, roughness: 0.3 })
  const bladeShape = new THREE.Shape(); const BL = 0.62, BW = 0.026
  bladeShape.moveTo(-BW, 0); bladeShape.lineTo(-BW * 0.9, BL * 0.7); bladeShape.quadraticCurveTo(-BW * 0.5, BL * 0.93, 0, BL); bladeShape.quadraticCurveTo(BW * 0.5, BL * 0.93, BW * 0.9, BL * 0.7); bladeShape.lineTo(BW, 0); bladeShape.lineTo(-BW, 0)
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 }); bladeGeo.translate(0, 0, -0.003)
  const blade = new THREE.Mesh(bladeGeo, steel); blade.position.y = top * 0.9 + 0.012; root.add(blade)
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.006, BL * 0.62, 0.0125), dark); fuller.position.set(0, top * 0.9 + 0.012 + BL * 0.38, 0); root.add(fuller)
  add(rbox(0.13, 0.016, 0.03, 0.006), gold, new V(0, top * 0.9 + 0.006, 0))
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.013, 10, 8), gold, new V(s * 0.066, top * 0.9 + 0.006, 0))
  add(new THREE.SphereGeometry(0.024, 14, 10), gold, new V(0, bottom * 1.3, 0.0))
  add(new THREE.TorusGeometry(0.026, 0.0035, 6, 20), grey, new V(0, bottom * 1.05, 0), align(new V(0, 1, 0), new V(0, 0, 1)))
  const tip = new V(0, top * 0.9 + 0.012 + BL, 0)
  root.scale.setScalar(1.35); root.position.set(0.2, -0.3, -0.62)
  return { root, tip }
}
