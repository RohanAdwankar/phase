import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js"

// linear multipliers that give each dimension its own colour grade
export const GRADE = [[1, 1, 1], [1.12, 1.02, 0.8], [0.84, 1.06, 1.08], [1.14, 0.9, 0.78], [0.96, 0.9, 1.16]]

const frag = `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uSunVis, uTime, uAspect, uPeek; uniform vec3 uTint;
varying vec2 vUv;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
void main(){
  vec2 c = vUv - 0.5; float edge = dot(c, c);
  vec2 uv = vUv + c * sin(uTime * 5.0 + edge * 40.0) * uPeek * 0.03;
  vec2 ca = c * (edge * 0.004 + uPeek * 0.012);
  vec3 col = vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);
  // sun shafts: radial blur of the bright parts of the frame toward the sun
  vec3 rays = vec3(0.0); vec2 d = (uSun - vUv) / 12.0, p = vUv; float w = 1.0;
  for (int i = 0; i < 12; i++) { p += d; vec3 s = texture2D(tDiffuse, p).rgb; rays += max(s - 2.5, 0.0) * w; w *= 0.88; }
  col += rays * vec3(1.0, 0.86, 0.62) * 0.035 * uSunVis;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.1);
  col *= mix(vec3(0.94, 0.98, 1.06), vec3(1.07, 1.02, 0.92), smoothstep(0.0, 1.5, l));
  col *= uTint;
  col *= 1.0 - edge * 1.1;
  col += uTint * uPeek * edge * 1.6;
  col += (rnd(vUv * 1000.0) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}`

export const makePost = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera) => {
  const composer = new EffectComposer(renderer)
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2() }, uSunVis: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uPeek: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: frag,
  })
  composer.addPass(new RenderPass(scene, cam))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.5, 2.2)
  composer.addPass(bloom)
  composer.addPass(grade)
  composer.addPass(new OutputPass())
  composer.addPass(new FXAAPass())
  const tmp = new THREE.Vector3()
  return {
    composer,
    update(sunDir: THREE.Vector3, d: number, time: number, calm = 0) {
      bloom.strength = 0.12 * (1 - calm * 0.7)
      tmp.copy(cam.position).addScaledVector(sunDir, 1000).project(cam)
      const behind = new THREE.Vector3().copy(sunDir).dot(cam.getWorldDirection(new THREE.Vector3())) < 0
      grade.uniforms.uSun.value.set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5)
      grade.uniforms.uSunVis.value = (behind ? 0 : Math.max(0, 1 - Math.hypot(tmp.x, tmp.y) * 0.35)) * (1 - calm)
      grade.uniforms.uTime.value = time % 10
      grade.uniforms.uPeek.value = Math.min(1, Math.abs(d - Math.round(d)) * 2)
      const i = Math.min(GRADE.length - 2, Math.floor(d)), t = d - i
      grade.uniforms.uTint.value.set(...(GRADE[i].map((v, k) => v + (GRADE[i + 1][k] - v) * t) as [number, number, number]))
    },
    resize(w: number, h: number, dpr: number) { composer.setPixelRatio(dpr); composer.setSize(w, h) },
  }
}
