import * as THREE from "three"
import { PBR } from "./assets"
import { gradient as toonGradient } from "./toon"

export const N = 5
// every material that belongs to one dimension, so the dimension phasing can fade it
export const registry: THREE.Material[][] = [...Array(N)].map(() => [])
export const track = <T extends THREE.Material>(dim: number, m: T) => { registry[dim].push(m); return m }
export const untrack = (dim: number, ms: THREE.Material[]) => { registry[dim] = registry[dim].filter(m => !ms.includes(m)) }

const NOISE = `float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float f2(vec2 p){ return 0.5 * n2(p) + 0.25 * n2(p * 2.03) + 0.125 * n2(p * 4.1) + 0.0625 * n2(p * 8.3); }`

// Two PBR layers blended by a rock weight: a vertex attribute (hills) or world-space noise (lane). A low frequency
// macro tint breaks up texture repetition.
export const splatMaterial = (a: PBR, b: PBR, o: { scaleB: number; attr?: boolean; tint?: number; c?: PBR }) => {
  const m = new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, aoMap: a.arm, roughnessMap: a.arm, roughness: 1, metalness: 0, color: o.tint ?? 0xffffff, transparent: true })
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { mapB: { value: b.map }, normalMapB: { value: b.normalMap }, armB: { value: b.arm }, scaleB: { value: o.scaleB }, mapC: { value: o.c?.map ?? b.map } })
    sh.vertexShader = (o.attr ? "attribute float aRock;\n" : "") + "varying float vW; varying vec3 vWP;\n" + sh.vertexShader.replace("#include <begin_vertex>",
      `#include <begin_vertex>\n vW = ${o.attr ? "aRock" : "0.0"}; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    const mixN = (s: string, tex: string, uv: string, extra = "") => s.replace(`texture2D( ${tex}, ${uv} )`, `mix(texture2D( ${tex}, ${uv} ), texture2D( ${tex}B, ${uv} * scaleB )${extra}, w)`)
    sh.fragmentShader = `uniform sampler2D mapB, normalMapB, armB, mapC; uniform float scaleB; varying float vW; varying vec3 vWP;\n${NOISE}\n` + sh.fragmentShader
      .replace("#include <map_fragment>", `float w = clamp(vW${o.attr ? "" : " + smoothstep(0.62, 0.78, f2(vWP.xz * 0.045))"}, 0.0, 1.0);
        vec4 base4 = mix(texture2D(map, vMapUv), texture2D(mapB, vMapUv * scaleB), w);
        ${o.c ? "base4 = mix(base4, texture2D(mapC, vMapUv * 0.9), smoothstep(0.5, 0.66, f2(vWP.xz * 0.07 + 31.0)) * 0.9);" : ""}
        float fine = dot(texture2D(map, vMapUv * 8.7).rgb, vec3(0.33));
        diffuseColor *= base4;
        diffuseColor.rgb *= (0.62 + 0.9 * f2(vWP.xz * 0.02 + 7.0)) * (0.75 + 0.7 * fine) * (0.85 + 0.3 * f2(vWP.xz * 0.5));`)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness * mix(texture2D(roughnessMap, vRoughnessMapUv).g, texture2D(armB, vRoughnessMapUv * scaleB).g, w);")
      .replace("#include <aomap_fragment>", THREE.ShaderChunk.aomap_fragment.replace("texture2D( aoMap, vAoMapUv ).r", "mix(texture2D(aoMap, vAoMapUv).r, texture2D(armB, vAoMapUv * scaleB).r, w)"))
      .replace("#include <normal_fragment_maps>", mixN(THREE.ShaderChunk.normal_fragment_maps.replace(/texture2D\( normalMap, vNormalMapUv \)/g, "texture2D( normalMap, vNormalMapUv )"), "normalMap", "vNormalMapUv"))
  }
  return m
}

export const pbrMaterial = (p: PBR, o: { tint?: number; metalness?: number; normalScale?: number } = {}) => new THREE.MeshStandardMaterial({
  map: p.map, normalMap: p.normalMap, aoMap: p.arm, roughnessMap: p.arm, metalnessMap: o.metalness ? p.arm : null, metalness: o.metalness ?? 0, roughness: 1,
  color: o.tint ?? 0xffffff, normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1), transparent: true,
})

// Relief shared by the ground mesh, the colliders and the grass shader. Every dimension reshapes the same rolling base differently, so
// each has its own landscape: 0 rolling hills, 1 terraced mesas, 2 long sharp ridges, 3 choppy hummocks, 4 flat plains with round hills.
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const base = (x: number, z: number) => 3.2 * Math.sin(x * 0.034 + 0.7) * Math.sin(z * 0.029 + 2.1) + 1.4 * Math.sin(x * 0.061 - z * 0.047) + 4.5 * Math.sin(x * 0.011 + 1.3) * Math.sin(z * 0.009) + 2.2 * Math.sin(x * 0.023 - z * 0.017) + 0.7 * (Math.sin(x * 0.09 + Math.sin(z * 0.05) * 2) * 0.5 + Math.sin(z * 0.07 + x * 0.03) * 0.5) + 0.25 * Math.sin(x * 0.31 + z * 0.17) * Math.sin(z * 0.23) + 0.06 * Math.sin(x * 0.9) * Math.sin(z * 0.8)
export const terrainY = (x: number, z: number, dim = 2) => {
  const b = base(x, z)
  if (dim === 1) { const s = b / 2.6, f = Math.floor(s); return (f + ss(0.35, 0.65, s - f)) * 2.6 * 0.9 }
  if (dim === 2) return b * 0.55 + 3.6 * Math.abs(Math.sin(x * 0.016 + z * 0.007 + 0.5 * Math.sin(z * 0.01))) - 1.8
  if (dim === 3) return b * 0.45 + 2.2 * Math.sin(x * 0.11) * Math.sin(z * 0.09) + 1.2 * Math.sin(x * 0.19 + z * 0.13)
  if (dim === 4) { const h = 0.5 + 0.5 * Math.sin(x * 0.02 + 1.0) * Math.sin(z * 0.018 + 0.4); return b * 0.25 + 7 * h * h * h }
  return b
}
const BASE_GLSL = `float baseY(vec2 p){ return 3.2 * sin(p.x * 0.034 + 0.7) * sin(p.y * 0.029 + 2.1) + 1.4 * sin(p.x * 0.061 - p.y * 0.047) + 4.5 * sin(p.x * 0.011 + 1.3) * sin(p.y * 0.009) + 2.2 * sin(p.x * 0.023 - p.y * 0.017) + 0.7 * (sin(p.x * 0.09 + sin(p.y * 0.05) * 2.0) * 0.5 + sin(p.y * 0.07 + p.x * 0.03) * 0.5) + 0.25 * sin(p.x * 0.31 + p.y * 0.17) * sin(p.y * 0.23) + 0.06 * sin(p.x * 0.9) * sin(p.y * 0.8); }`
const TERRAIN_BODY = [
  "return b;",
  "float s = b / 2.6, f = floor(s); return (f + smoothstep(0.35, 0.65, s - f)) * 2.6 * 0.9;",
  "return b * 0.55 + 3.6 * abs(sin(p.x * 0.016 + p.y * 0.007 + 0.5 * sin(p.y * 0.01))) - 1.8;",
  "return b * 0.45 + 2.2 * sin(p.x * 0.11) * sin(p.y * 0.09) + 1.2 * sin(p.x * 0.19 + p.y * 0.13);",
  "float h = 0.5 + 0.5 * sin(p.x * 0.02 + 1.0) * sin(p.y * 0.018 + 0.4); return b * 0.25 + 7.0 * h * h * h;",
]
const terrainGlsl = (dim: number) => `${BASE_GLSL}\nfloat terrainY(vec2 p){ float b = baseY(p); ${TERRAIN_BODY[dim]} }`
export const uTime = { value: 0 }
export const uPlayer = { value: new THREE.Vector3() }
const hashGLSL = "float hh(float n){ return fract(sin(n) * 43758.5453); }"

// Grass blades generated entirely in the vertex shader from the instance id, so a patch costs no CPU or memory per blade.
export const grassMaterial = (patch: THREE.Vector4, tint: number, undergrowth = false, dim = 2) => {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, side: THREE.DoubleSide, color: tint, gradientMap: toonGradient, transparent: true })
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uTime, uPlayer, uPatch: { value: patch } })
    sh.vertexShader = `uniform float uTime; uniform vec3 uPlayer; uniform vec4 uPatch;\n${hashGLSL}\n${terrainGlsl(dim)}\n` + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      float id = float(gl_InstanceID), cid = floor(id / 9.0);
      // blades grow in tufts of nine that splay outward from a shared centre
      vec2 centre = vec2(uPatch.x + hh(cid * 1.31 + 7.0) * uPatch.z, uPatch.y + hh(cid * 2.17 + 3.0) * uPatch.w);
      vec2 off = (vec2(hh(id * 3.1 + 1.0), hh(id * 4.7 + 2.0)) - 0.5) * 0.5;
      vec3 base = vec3(centre + off, 0.0); base = vec3(base.x, terrainY(base.xy), base.y);
      float dist = distance(base.xz, uPlayer.xz), rk = hh(cid * 7.1 + 2.0), rh = hh(id * 5.3 + 9.0), tuft = hh(cid * 5.3 + 4.0);
      float ang = atan(-off.x, off.y) + (hh(id * 3.7 + 1.0) - 0.5) * 1.0;
      float keep = step(rk, clamp(1.0 - (dist - 6.0) / ${undergrowth ? "18.0" : "46.0"}, 0.0, 1.0));
      float clump = 0.5 + 0.5 * sin(base.x * 0.9 + sin(base.z * 1.3) * 2.0) * sin(base.z * 0.8 + base.x * 0.4);
      float sc = (${undergrowth ? "0.2 + tuft * 0.22" : "0.38 + tuft * 0.55"}) * (0.75 + 0.5 * rh) * (0.7 + 0.8 * clump) * keep;
      float k = pow(position.y * 1.6, 2.0);
      vec3 p = position * sc;
      p.x += (sin(uTime * 1.7 + base.x * 0.35 + base.z * 0.27) * 0.16 + sin(uTime * 3.1 + base.x * 1.3) * 0.03) * k * sc;
      p.z += cos(uTime * 1.3 + base.z * 0.4) * 0.09 * k * sc;
      float ca = cos(ang), sa = sin(ang); p.xz = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z);
      transformed = p + base;
      vColor.rgb *= 0.9 + 0.2 * hh(id * 11.7) + 0.25 * (tuft - 0.5);`)
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
  }
  return m
}
