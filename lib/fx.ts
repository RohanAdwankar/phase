import * as THREE from "three"

const V = THREE.Vector3
const MAX = 400, CASE = 20
const dot = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 32
  const g = c.getContext("2d")!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 32, 32)
  return new THREE.CanvasTexture(c)
})()

export const makeFx = (scene: THREE.Scene) => {
  const pos = new Float32Array(MAX * 3).fill(-1e4), col = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3), life = new Float32Array(MAX)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
  const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, map: dot, alphaTest: 0.01, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
  sparks.frustumCulled = false
  const casingMat = new THREE.MeshStandardMaterial({ color: 0xd8b44a, metalness: 1, roughness: 0.3 })
  const casings = [...Array(CASE)].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.026, 8), casingMat); m.visible = false; return m })
  const cv = casings.map(() => new V()), cl = casings.map(() => 0)
  const motes = new Float32Array(150 * 3).map(() => (Math.random() - 0.5) * 30)
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute("position", new THREE.BufferAttribute(motes, 3))
  const dust = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.06, map: dot, color: 0xfff2d0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }))
  dust.frustumCulled = false
  scene.add(sparks, dust, ...casings)
  let head = 0, ci = 0, t = 0
  const prev = new V()

  return {
    spark(p: THREE.Vector3, n: number, dir: THREE.Vector3, color: THREE.Color) {
      for (let k = 0; k < n; k++) {
        const i = head++ % MAX
        pos.set([p.x, p.y, p.z], i * 3)
        vel.set([dir.x * 3 + (Math.random() - 0.5) * 5, dir.y * 3 + Math.random() * 3, dir.z * 3 + (Math.random() - 0.5) * 5], i * 3)
        col.set([color.r * 2, color.g * 2, color.b * 2], i * 3); life[i] = 0.4 + Math.random() * 0.5
      }
    },
    casing(p: THREE.Vector3, v: THREE.Vector3) {
      const i = ci++ % CASE; casings[i].position.copy(p); cv[i].copy(v); cl[i] = 1.2; casings[i].visible = true
      casings[i].rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
    },
    update(dt: number, cam: THREE.Vector3) {
      t += dt
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) continue
        life[i] -= dt; vel[i * 3 + 1] -= 9 * dt
        for (let a = 0; a < 3; a++) { pos[i * 3 + a] += vel[i * 3 + a] * dt; col[i * 3 + a] *= 1 - 2 * dt }
        if (life[i] <= 0) pos[i * 3 + 1] = -1e4
      }
      geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true
      casings.forEach((c, i) => {
        if (cl[i] <= 0) return
        cl[i] -= dt; cv[i].y -= 9 * dt; c.position.addScaledVector(cv[i], dt); c.rotation.x += 12 * dt
        if (c.position.y < 0.02 || cl[i] <= 0) c.visible = false
      })
      const dx = cam.x - prev.x, dy = cam.y - prev.y, dz = cam.z - prev.z; prev.copy(cam)
      for (let i = 0; i < 150; i++) {
        motes[i * 3] = ((motes[i * 3] - dx + 0.1 * Math.sin(t + i) * dt + 15 + 30) % 30) - 15
        motes[i * 3 + 1] = ((motes[i * 3 + 1] - dy + 0.2 * dt + 15 + 30) % 30) - 15
        motes[i * 3 + 2] = ((motes[i * 3 + 2] - dz + 15 + 30) % 30) - 15
      }
      moteGeo.attributes.position.needsUpdate = true; dust.position.copy(cam)
    },
  }
}
