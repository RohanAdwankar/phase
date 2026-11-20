import * as THREE from "three"
import { tileFbm } from "./noise"

// Stylised look: flat colour, hard-edged painted blotches and banded lighting, in the spirit of Risk of Rain 2.
export const PALETTE = [
  { grass: 0x5f9e2e, g1: 0x7db83c, g2: 0x437a26, blade: 0x72b236, rock: 0x4a4a70, moss: 0x5f9a2c, tree: 0x2f7a4a, plant: 0x62b034 },
  { grass: 0xc9a63c, g1: 0xdfbd4c, g2: 0xa7842c, blade: 0xd9b845, rock: 0x70505a, moss: 0xb89a36, tree: 0x9a5a2a, plant: 0xc4a23a },
  { grass: 0x3fa67f, g1: 0x58c496, g2: 0x2c8265, blade: 0x4fc29a, rock: 0x41608c, moss: 0x3fa67f, tree: 0x1f6a6a, plant: 0x46b890 },
  { grass: 0xc4673a, g1: 0xdb8442, g2: 0x9b4a2b, blade: 0xd47a3e, rock: 0x66425c, moss: 0xc4673a, tree: 0x7a3a3a, plant: 0xc86a3a },
  { grass: 0x7d66bc, g1: 0x9c85d8, g2: 0x5b4b9a, blade: 0x9a82d4, rock: 0x453e78, moss: 0x7d66bc, tree: 0x4a3a8a, plant: 0x8a72c8 },
]

export const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([85, 135, 185, 225]), 4, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t
})()

const hex = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]

// three flat tones in hard-edged organic blotches, tiled seamlessly
export const groundTexture = (dim: number) => {
  const p = PALETTE[dim], base = hex(p.grass), lo = hex(p.g2), hi = hex(p.g1), size = 512
  const c = document.createElement("canvas"); c.width = c.height = size
  const g = c.getContext("2d")!, img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, a = tileFbm(u, v, 3, 3, 2 + dim), b = tileFbm(u, v, 6, 3, 9 + dim), n = a * 0.7 + b * 0.3
    const col = n < 0.43 ? lo : n > 0.56 ? hi : base, j = (y * size + x) * 4
    img.data.set([col[0], col[1], col[2], 255], j)
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  return t
}

// toon material that keeps the source's cut-out alpha but paints it one flat colour, with painted moss on up-facing surfaces
export const flatten = (src: THREE.Material, color: number, moss?: number): THREE.Material => {
  const s = src as THREE.MeshStandardMaterial
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient, map: s.alphaTest > 0 || s.transparent ? s.map : null, alphaTest: s.alphaTest, side: THREE.DoubleSide, transparent: true })
  m.onBeforeCompile = sh => {
    sh.uniforms.uMoss = { value: new THREE.Color(moss ?? color) }
    sh.vertexShader = "varying vec3 vWN; varying vec3 vWP;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      mat4 mm = modelMatrix;
      #ifdef USE_INSTANCING
        mm = modelMatrix * instanceMatrix;
      #endif
      vWN = normalize(mat3(mm) * normal); vWP = (mm * vec4(position, 1.0)).xyz;`)
    sh.fragmentShader = `uniform vec3 uMoss; varying vec3 vWN; varying vec3 vWP;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
      ${sh.fragmentShader}`.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        float a0 = texture2D(map, vMapUv).a;
        diffuseColor.a *= a0;
      #endif
      ${moss !== undefined ? `
      float n = nn(vWP.xz * 0.35 + vWP.y * 0.2);
      float top = step(0.62 - 0.12 * n, normalize(vWN).y);
      diffuseColor.rgb = mix(diffuseColor.rgb * (0.78 + 0.45 * step(0.5, nn(vWP.xy * 0.5 + vWP.zy * 0.4))), uMoss, top);` : ""}`)
  }
  return m
}
