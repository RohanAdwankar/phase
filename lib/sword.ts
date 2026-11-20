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


  // long curved single-edged blade with a gold handle, after the reference: black spine, bright serrated edge, tapering to a swept tip
  const BL = 1.0, BW = 0.05, CURVE = 0.16
  const steelEdge = new THREE.MeshStandardMaterial({ color: 0xb4b9c0, metalness: 0.8, roughness: 0.5, envMapIntensity: 0.35 })
  const blackSteel = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.5, envMapIntensity: 0.35 })
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.5, envMapIntensity: 0.5, normalMap: trimNormal, normalScale: new THREE.Vector2(0.4, 0.4) })
  const spine = (t: number) => new V(CURVE * t * t * BL * 0.6, t * BL, 0)
  const half = (t: number) => (t < 0.9 ? BW : BW * Math.max(0.05, 1 - (t - 0.9) / 0.1 * 0.95)) * (1 - 0.18 * t)
  const outline = (lo: number, hi: number) => {
    const sh = new THREE.Shape(), n = 40, top: THREE.Vector3[] = [], bot: THREE.Vector3[] = []
    for (let k = 0; k <= n; k++) { const t = k / n, p = spine(t), tan = spine(Math.min(1, t + 0.01)).sub(spine(Math.max(0, t - 0.01))).normalize(), nrm = new V(tan.y, -tan.x, 0), w = half(t); top.push(p.clone().addScaledVector(nrm, -w * lo)); bot.push(p.clone().addScaledVector(nrm, w * hi)) }
    sh.moveTo(top[0].x, top[0].y); top.forEach(p => sh.lineTo(p.x, p.y)); for (let k = n; k >= 0; k--) sh.lineTo(bot[k].x, bot[k].y); sh.closePath(); return sh
  }
  const y0 = 0.1
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(1, 1), { depth: 0.007, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 4 }).translate(0, 0, -0.0035), blackSteel); blade.position.y = y0; root.add(blade)
  const edgeGeo = new THREE.ExtrudeGeometry(outline(-0.05, 1), { depth: 0.0078, bevelEnabled: true, bevelThickness: 0.0035, bevelSize: 0.002, bevelSegments: 2, curveSegments: 4 }).translate(0, 0, -0.0039)
  const edge = new THREE.Mesh(edgeGeo, steelEdge); edge.position.y = y0; edge.scale.set(1, 0.985, 1); root.add(edge)
  // serrations along the edge
  for (let k = 0; k < 26; k++) { const t = 0.12 + k * 0.032, p = spine(t), tan = spine(t + 0.01).sub(spine(t - 0.01)).normalize(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.0095), blackSteel); m.position.set(p.x + tan.y * half(t) * 0.55, y0 + p.y, 0); m.rotation.z = Math.atan2(tan.x, tan.y) - 0.7; root.add(m) }
  // long gold handle with cut-outs, a heavy guard and a hooked pommel
  add(rbox(0.034, 0.34, 0.046, 0.012), brass, new V(0.0, -0.1 + 0.0, 0))
  for (const y of [-0.02, -0.1, -0.18]) add(rbox(0.036, 0.04, 0.02, 0.006), blackSteel, new V(0.0, y, 0.0))
  for (const y of [-0.04, -0.14, -0.22]) add(new THREE.TorusGeometry(0.026, 0.004, 6, 20), steelEdge, new V(0, y, 0), align(new V(0, 1, 0), new V(0, 0, 1)))
  add(rbox(0.07, 0.05, 0.06, 0.014), brass, new V(0.006, y0 - 0.02, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.12)))
  add(rbox(0.02, 0.07, 0.07, 0.01), brass, new V(-0.03, y0 - 0.03, 0))
  add(rbox(0.05, 0.05, 0.06, 0.014), brass, new V(0.0, -0.28, 0.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.35)))
  const shiny = [steelEdge, blackSteel, brass]
  const tip = spine(1).add(new V(0, y0, 0))
  root.scale.setScalar(1)
  return { root, tip, shiny }
}
