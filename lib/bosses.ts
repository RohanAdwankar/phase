import * as THREE from "three"
import { track } from "./materials"
import { PALETTE } from "./toon"

// Bosses get their own bodies instead of the brute's: the warden is a floating obelisk wrapped in rings and shards, and each guardian is shaped by its attack.
// Every part is a flat-shaded solid in the dimension's own colour with glowing accents, built per dimension so it fades with the world.
export type BossBody = { mesh: THREE.Group; update: (dt: number, moving: boolean, phase: number, slam?: number) => void; turret: THREE.Object3D }

export const buildBoss = (kind: "boss" | "guardian", dim: number): BossBody => {
  const col = new THREE.Color(PALETTE[dim].g1), dark = new THREE.Color(0x14161b).lerp(col, 0.18)
  const solid = (c: THREE.Color, rough = 0.5, metal = 0.55) => { const m = track(dim, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, flatShading: true, transparent: true })); m.userData.xray = true; return m }
  const glow = () => { const m = track(dim, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.4), toneMapped: false, transparent: true })); m.userData.xray = true; return m }
  const body = solid(dark), mid = solid(col.clone().multiplyScalar(0.55), 0.6, 0.3), lit = glow()
  const g = new THREE.Group(), turret = new THREE.Object3D()
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = g) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o }
  const bx = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
  const cone = (r: number, h: number, n = 5) => new THREE.ConeGeometry(r, h, n)
  const group = (x: number, y: number, z: number) => { const o = new THREE.Group(); o.position.set(x, y, z); g.add(o); return o }
  let update: BossBody["update"] = () => {}

  if (kind === "boss") {
    // the warden: a tall obelisk with a glowing seam, three tilted rings and a swarm of shards, hovering clear of the ground
    const core = group(0, 5.6, 0)
    part(new THREE.OctahedronGeometry(1.5, 0), body, 0, 0, 0, core).scale.set(1, 2.6, 1)
    part(new THREE.OctahedronGeometry(0.7, 0), lit, 0, 0.3, 0, core).scale.set(1, 1.6, 1)
    part(bx(0.12, 7.2, 0.12), lit, 0, 0, 0, core)
    const rings = [0, 1, 2].map(i => { const r = group(0, 5.6, 0); part(new THREE.TorusGeometry(2.4 + i * 0.7, 0.14, 5, 18), i === 1 ? lit : mid, 0, 0, 0, r); r.rotation.set(0.5 + i * 0.9, i * 1.1, i * 0.4); return r })
    const shards = [...Array(8)].map((_, i) => { const s = group(0, 5.6, 0); part(new THREE.TetrahedronGeometry(0.55, 0), i % 2 ? lit : body, 3.6, 0, 0, s); s.rotation.set(0, (i / 8) * Math.PI * 2, 0); s.userData.k = i; return s })
    const crown = [-1, 0, 1].map(i => part(cone(0.35, 1.6, 4), body, i * 0.8, 9.6 - Math.abs(i) * 0.5, 0))
    turret.position.set(0, 5.6, -1.2); g.add(turret)
    update = (dt, _m, phase) => {
      const t = phase * 0.2
      core.position.y = 5.6 + Math.sin(t * 2) * 0.35; core.rotation.y += dt * 0.6
      rings.forEach((r, i) => { r.position.y = core.position.y; r.rotation.y += dt * (0.8 + i * 0.5) * (i % 2 ? -1 : 1); r.rotation.x += dt * 0.3 })
      shards.forEach(s => { s.position.y = core.position.y + Math.sin(t * 3 + s.userData.k) * 0.8; s.rotation.y += dt * 1.6 })
      crown.forEach((c, i) => (c.position.y = core.position.y + 4 - Math.abs(i - 1) * 0.5))
    }
  } else if (dim === 0) {
    // stomper: a hulking golem, two oversized fists, a slab head, plates down its back
    part(bx(4, 3.4, 2.6), body, 0, 3.6, 0); part(bx(2.2, 1.4, 1.6), mid, 0, 5.8, 0.2); part(bx(1.4, 0.4, 0.2), lit, 0, 5.9, -0.7)
    part(bx(5.6, 1.1, 2.2), mid, 0, 4.9, 0); [-1, 1].forEach(s => part(cone(0.7, 1.2, 4), body, s * 2.6, 5.9, 0))
    part(bx(1.1, 2.2, 1.1), body, -0.9, 1.1, 0); part(bx(1.1, 2.2, 1.1), body, 0.9, 1.1, 0); part(bx(1.5, 0.5, 1.7), mid, -0.9, 0.25, 0.1); part(bx(1.5, 0.5, 1.7), mid, 0.9, 0.25, 0.1)
    for (let i = 0; i < 4; i++) part(bx(3.2 - i * 0.3, 0.4, 0.5), lit, 0, 2.6 + i * 0.7, 1.4)
    const arms = [-1, 1].map(s => { const a = group(s * 2.9, 4.8, 0); part(bx(1, 3.2, 1), body, 0, -1.6, 0, a); part(bx(2, 2, 2), mid, 0, -3.5, 0, a); part(bx(2.1, 0.2, 2.1), lit, 0, -2.6, 0, a); return a })
    turret.position.set(0, 5.8, -1); g.add(turret)
    update = (_dt, moving, phase, slam = 0) => arms.forEach((a, i) => (a.rotation.x = slam > 0 ? -2.6 + (1 - slam) * 2.8 : moving ? Math.sin(phase * 1.1 + i * Math.PI) * 0.4 : 0))
  } else if (dim === 1) {
    // sniper: a heavy tripod gunship, a big armoured hub with a glowing scope, a thick long barrel with stabiliser fins, a radar dish and an antenna
    const hub = group(0, 6.4, 0); part(new THREE.IcosahedronGeometry(1.9, 0), body, 0, 0, 0, hub); part(bx(3.4, 1.2, 3.4), mid, 0, -0.9, 0, hub)
    part(new THREE.SphereGeometry(0.85, 10, 8), lit, 0, 0.1, -1.7, hub); part(new THREE.TorusGeometry(0.95, 0.12, 5, 12), mid, 0, 0.1, -1.75, hub)
    const dish = group(0, 2.2, 0.4); hub.add(dish); part(new THREE.ConeGeometry(1.5, 0.8, 8, 1, true), mid, 0, 0, 0, dish).rotation.x = Math.PI * 0.55; part(bx(0.15, 1.2, 0.15), body, 0, -0.7, 0, dish); part(bx(0.1, 2.8, 0.1), lit, 0.9, 1.3, 0, dish)
    const barrel = group(0, 0, 0); hub.add(barrel); part(bx(0.75, 0.75, 7.2), body, 0, 0, -4.8, barrel); part(bx(1.05, 1.05, 0.9), lit, 0, 0, -8.5, barrel); part(bx(0.35, 1.9, 2.4), mid, 0, 0, -4.4, barrel); part(bx(1.9, 0.35, 2.4), mid, 0, 0, -4.4, barrel)
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.4, lg = group(Math.cos(a) * 1.4, 5.6, Math.sin(a) * 1.4); part(bx(0.8, 6.4, 0.8), body, Math.cos(a) * 1.5, -2.9, Math.sin(a) * 1.5, lg); part(bx(2, 0.4, 2), mid, Math.cos(a) * 3.0, -6.2, Math.sin(a) * 3.0, lg); lg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4) }
    turret.position.set(0, 0, -9); barrel.add(turret)
    update = (_dt, _m, phase) => { hub.position.y = 6.4 + Math.sin(phase * 0.15) * 0.2; barrel.rotation.x = Math.sin(phase * 0.1) * 0.04; dish.rotation.y += _dt * 1.5 }
  } else if (dim === 2) {
    // summoner: a floating crystal heart with orbiting pods and a hanging tail
    const heart = group(0, 4.6, 0); part(new THREE.OctahedronGeometry(1.8, 0), body, 0, 0, 0, heart).scale.set(1, 1.5, 1); part(new THREE.OctahedronGeometry(0.9, 0), lit, 0, 0, 0, heart).scale.set(1, 1.5, 1)
    const pods = [...Array(5)].map((_, i) => { const o = group(0, 4.6, 0); part(new THREE.SphereGeometry(0.55, 8, 6), i % 2 ? lit : mid, 3, 0, 0, o); o.userData.k = i; return o })
    for (let i = 0; i < 5; i++) part(cone(0.35 - i * 0.04, 1.4, 4), i % 2 ? mid : body, 0, 2.1 - i * 0.95, 0).rotation.x = Math.PI
    const halo = part(new THREE.TorusGeometry(2.6, 0.1, 4, 14), lit, 0, 4.6, 0); halo.rotation.x = Math.PI / 2
    turret.position.set(0, 4.6, -1.6); g.add(turret)
    update = (dt, _m, phase) => { heart.position.y = 4.6 + Math.sin(phase * 0.15) * 0.4; heart.rotation.y += dt * 0.7; halo.position.y = heart.position.y; halo.rotation.z += dt * 0.5; pods.forEach(p => { p.position.y = heart.position.y + Math.sin(phase * 0.2 + p.userData.k) * 0.7; p.rotation.y += dt * (1 + p.userData.k * 0.2) }) }
  } else if (dim === 3) {
    // charger: a low armoured beast with a ram horn, a spiked back and four short legs
    part(bx(3.4, 2.6, 6), body, 0, 2.6, 0); part(new THREE.BoxGeometry(2.4, 2, 2.6), mid, 0, 2.5, -3.6); part(cone(0.9, 3.4, 4), lit, 0, 2.7, -5.9).rotation.x = -Math.PI / 2
    for (let i = 0; i < 6; i++) part(cone(0.4, 1.5, 4), i % 2 ? mid : body, 0, 4.3, 2.2 - i * 0.95)
    part(bx(3.6, 0.4, 2), lit, 0, 3.3, -0.2)
    const legs = [[-1.6, -2], [1.6, -2], [-1.6, 2], [1.6, 2]].map(([x, z]) => { const l = group(x, 1.8, z); part(bx(0.9, 1.8, 0.9), mid, 0, -0.9, 0, l); part(bx(1.2, 0.4, 1.3), body, 0, -1.8, 0.1, l); return l })
    turret.position.set(0, 3.6, -4); g.add(turret)
    update = (_dt, moving, phase) => legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(phase * 1.6 + i * Math.PI * 0.5) * 0.6 : 0))
  } else {
    // blinker: a bright core ringed by six blades that spin and flare when it fires
    const core = group(0, 4.2, 0); part(new THREE.IcosahedronGeometry(1.1, 0), lit, 0, 0, 0, core); part(new THREE.IcosahedronGeometry(1.6, 0), body, 0, 0, 0, core).scale.set(1, 1.2, 1)
    const blades = [...Array(6)].map((_, i) => { const b = group(0, 4.2, 0); part(bx(0.2, 3.4, 1.5), i % 2 ? mid : body, 2.8, 0, 0, b); part(cone(0.25, 0.9, 3), lit, 2.8, 2.1, 0, b); b.rotation.y = (i / 6) * Math.PI * 2; return b })
    part(cone(0.6, 2.2, 5), body, 0, 1.9, 0).rotation.x = Math.PI
    turret.position.set(0, 4.2, -1.4); g.add(turret)
    update = (dt, _m, phase) => { core.position.y = 4.2 + Math.sin(phase * 0.18) * 0.5; core.rotation.y -= dt * 0.9; blades.forEach((b, i) => { b.position.y = core.position.y; b.rotation.y += dt * 1.8; b.rotation.z = Math.sin(phase * 0.2 + i) * 0.25 }) }
  }
  g.scale.setScalar(kind === "boss" ? 1.6 : 1.4)
  return { mesh: g, update, turret }
}
