import * as THREE from "three"
import { PBR } from "./assets"

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
export const splatMaterial = (a: PBR, b: PBR, o: { scaleB: number; attr?: boolean; tint?: number }) => {
  const m = new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, aoMap: a.arm, roughnessMap: a.arm, roughness: 1, metalness: 0, color: o.tint ?? 0xffffff, transparent: true })
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { mapB: { value: b.map }, normalMapB: { value: b.normalMap }, armB: { value: b.arm }, scaleB: { value: o.scaleB } })
    sh.vertexShader = (o.attr ? "attribute float aRock;\n" : "") + "varying float vW; varying vec3 vWP;\n" + sh.vertexShader.replace("#include <begin_vertex>",
      `#include <begin_vertex>\n vW = ${o.attr ? "aRock" : "0.0"}; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    const mixN = (s: string, tex: string, uv: string, extra = "") => s.replace(`texture2D( ${tex}, ${uv} )`, `mix(texture2D( ${tex}, ${uv} ), texture2D( ${tex}B, ${uv} * scaleB )${extra}, w)`)
    sh.fragmentShader = `uniform sampler2D mapB, normalMapB, armB; uniform float scaleB; varying float vW; varying vec3 vWP;\n${NOISE}\n` + sh.fragmentShader
      .replace("#include <map_fragment>", `float w = clamp(vW${o.attr ? "" : " + smoothstep(0.52, 0.68, f2(vWP.xz * 0.045))"}, 0.0, 1.0);
        diffuseColor *= mix(texture2D(map, vMapUv), texture2D(mapB, vMapUv * scaleB), w);
        diffuseColor.rgb *= 0.78 + 0.5 * f2(vWP.xz * 0.02 + 7.0);`)
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

export const uTime = { value: 0 }
export const uPlayer = { value: new THREE.Vector3() }
const hashGLSL = "float hh(float n){ return fract(sin(n) * 43758.5453); }"

// Grass blades generated entirely in the vertex shader from the instance id, so a patch costs no CPU or memory per blade.
export const grassMaterial = (patch: THREE.Vector4, tint: number) => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, color: tint, transparent: true })
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uTime, uPlayer, uPatch: { value: patch } })
    sh.vertexShader = `uniform float uTime; uniform vec3 uPlayer; uniform vec4 uPatch;\n${hashGLSL}\n` + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      float id = float(gl_InstanceID);
      vec3 base = vec3(uPatch.x + hh(id * 1.31 + 7.0) * uPatch.z, 0.0, uPatch.y + hh(id * 2.17 + 3.0) * uPatch.w);
      float dist = distance(base.xz, uPlayer.xz), rk = hh(id * 7.1 + 2.0), rh = hh(id * 5.3 + 9.0), ang = hh(id * 3.7 + 1.0) * 6.2832;
      float keep = step(rk, clamp(1.0 - (dist - 6.0) / 30.0, 0.03, 1.0));
      float sc = (0.42 + rh * 0.75) * keep;
      float k = pow(position.y * 1.6, 2.0);
      vec3 p = vec3(position.x, position.y, position.z) * sc;
      p.x += (sin(uTime * 1.7 + base.x * 0.35 + base.z * 0.27) * 0.16 + sin(uTime * 3.1 + base.x * 1.3) * 0.03) * k * sc;
      p.z += cos(uTime * 1.3 + base.z * 0.4) * 0.09 * k * sc;
      float ca = cos(ang), sa = sin(ang); p.xz = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z);
      transformed = p + base;
      vColor.rgb *= 0.6 + 0.55 * hh(id * 11.7);
      vColor.rgb = mix(vColor.rgb, vec3(0.55, 0.5, 0.2) * (0.35 + position.y), hh(id * 13.1) * 0.5);`)
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
  }
  return m
}
