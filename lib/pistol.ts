import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { PBR } from "./assets"
import { pbrMaterial } from "./materials"

const V = THREE.Vector3
const rbox = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, r)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const makePistol = (flashMap: THREE.Texture, pistol: { geo: THREE.BufferGeometry; mat: THREE.Material; box: THREE.Box3 }, armor: PBR) => {
  const root = new THREE.Group()
  const solid = <T extends THREE.Material>(m: T) => { m.transparent = false; m.side = THREE.DoubleSide; return m }
  const trimNormal = armor.normalMap.clone(); trimNormal.repeat.set(0.4, 0.4); trimNormal.needsUpdate = true
  const suit = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.75, metalness: 0.1 })
  const gold = suit, grey = suit, orange = suit, glow = suit

  const size = pistol.box.getSize(new V())
  const gun = new THREE.Mesh(pistol.geo, pistol.mat)
  gun.rotation.y = Math.PI / 2; gun.position.set(0, -pistol.box.min.y - size.y * 0.5, pistol.box.min.x + 0.07)
  root.add(gun)
  const len = size.x, top = size.y * 0.5, bottom = -top

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
  // forearm: wrist narrows into a cuff, swells over the muscle and eases into the elbow; the cuff hides the join with the hand
  const cuffMat = new THREE.MeshStandardMaterial({ color: 0x2c2e34, roughness: 0.55, metalness: 0.2 })
  const arm = (pts: THREE.Vector3[], wristR: number, elbowR: number) => {
    const c = new THREE.CatmullRomCurve3(pts), n = 20, rad = (t: number) => lerp(wristR, elbowR, t) * (1 + 0.3 * Math.sin(Math.PI * Math.min(1, t * 1.25)))
    for (let i = 0; i < n; i++) {
      const a = c.getPoint(i / n), b = c.getPoint((i + 1) / n), r0 = rad(i / n), r1 = rad((i + 1) / n)
      add(new THREE.CylinderGeometry(r1, r0, a.distanceTo(b) * 1.04, 18), suit, a.clone().lerp(b, 0.5), align(b.clone().sub(a)))
      add(new THREE.SphereGeometry(r0, 16, 12), suit, a)
    }
    const q = align(c.getTangent(0.06)), p = c.getPoint(0.06)
    add(new THREE.CylinderGeometry(wristR * 1.34, wristR * 1.46, 0.05, 22), cuffMat, p, q)
    add(new THREE.TorusGeometry(wristR * 1.42, 0.0045, 8, 24), cuffMat, c.getPoint(0.06).addScaledVector(c.getTangent(0.06), 0.027), align(c.getTangent(0.06), new V(0, 0, 1)))
  }

  // fingers wrap around the grip along an ellipse in the horizontal plane
  const gx = 0, gz = 0.03, rx = 0.027, rz = 0.04
  const finger = (y: number, a0: number, a1: number, scale: number, r: number, mat: THREE.Material) => {
    const pts = [0, 1, 2, 3].map(k => { const a = lerp(a0, a1, k / 3); return new V(gx + Math.sin(a) * rx * scale, y, gz + Math.cos(a) * rz * scale) })
    pts.forEach((p, k) => {
      add(new THREE.SphereGeometry(r * (1 - k * 0.06), 12, 10), mat, p)
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
  add(rbox(0.012, size.y * 0.56, 0.055, 0.005), suit, new V(gx + 0.058, bottom * 0.4, gz + 0.046), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.35, 0)))
  limbChain([new V(gx + 0.022, top * 0.08, gz + 0.062), new V(gx - 0.026, top * 0.12, gz + 0.03), new V(gx - 0.034, top * 0.2, gz - 0.02), new V(gx - 0.03, top * 0.18, gz - 0.055)], 0.0125, suit)
  limbChain([new V(gx + 0.032, top * 0.3, gz + 0.04), new V(gx + 0.034, top * 0.28, gz - 0.02), new V(gx + 0.03, top * 0.2, gz - 0.07)], 0.0105, suit)
  arm([new V(gx + 0.03, bottom * 0.42, gz + 0.09), new V(gx + 0.06, bottom * 1.05, gz + 0.2), new V(gx + 0.1, -0.17, gz + 0.4), new V(gx + 0.17, -0.36, gz + 0.72)], 0.019, 0.031)

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, size.y * 0.25, -len * 0.75); root.add(muzzle)
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0 }))
  flash.scale.setScalar(0.2); muzzle.add(flash)
  const light = new THREE.PointLight(0xff9a3a, 0, 3); muzzle.add(light)
  root.scale.setScalar(1.7); root.position.set(0.14, -0.13, -0.32)
  return { root, muzzle, flash, light, eject: new V(0.03, size.y * 0.3, -len * 0.1) }
}
