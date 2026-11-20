import * as THREE from "three"

export const SUN = new THREE.Vector3(-0.55, 0.72, -0.35).normalize()

// Painted cartoon sky: a banded gradient, flat-shaded puffy clouds with a darker underside, and a flat sun disc.
const frag = `varying vec3 p; uniform vec3 sun; uniform float t;
float h(vec2 v){ return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 v){ vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 v){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(v); v *= 2.07; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(p); float y = d.y;
  vec3 hor = vec3(0.72, 0.9, 0.98), mid = vec3(0.36, 0.66, 0.92), zen = vec3(0.2, 0.42, 0.82);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.3, y)); c = mix(c, zen, smoothstep(0.3, 0.85, y));
  c = floor(c * 9.0 + 0.5) / 9.0;
  vec2 uv = d.xz / (abs(y) + 0.28) * 0.9 + vec2(t * 0.012, 0.0);
  float f = fbm(uv * 1.6), g = fbm(uv * 1.6 + vec2(-0.14, 0.2));
  float cloud = smoothstep(0.545, 0.55, f) * smoothstep(-0.02, 0.1, y);
  float shade = smoothstep(0.545, 0.55, f) - smoothstep(0.545, 0.55, g);
  vec3 cc = mix(vec3(1.0), vec3(0.72, 0.8, 0.94), clamp(shade * 2.0, 0.0, 1.0));
  c = mix(c, cc, cloud);
  float s = dot(d, sun);
  c = mix(c, vec3(1.0, 0.96, 0.78), step(0.9975, s));
  c = mix(c, c + vec3(0.12, 0.1, 0.02), step(0.985, s) * 0.5);
  c = mix(c, vec3(0.42, 0.62, 0.38), smoothstep(0.0, -0.08, y));
  gl_FragColor = vec4(c, 1.0);
}`

export const sunUniform = { value: SUN }
export const skyTime = { value: 0 }
export const makeSky = (radius: number) => new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sun: sunUniform, t: skyTime },
  vertexShader: "varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: frag,
}))
