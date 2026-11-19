import * as THREE from "three"

export const SUN = new THREE.Vector3(-0.35, 0.36, -0.86).normalize()

const frag = `varying vec3 p; uniform vec3 sun;
float h(vec2 v){ return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 v){ vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 v){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(v); v *= 2.03; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(p); float y = d.y;
  vec3 hor = vec3(0.74, 0.84, 0.93), zen = vec3(0.14, 0.34, 0.74);
  vec3 c = mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.45));
  float s = max(dot(d, sun), 0.0);
  c += vec3(1.0, 0.8, 0.5) * (pow(s, 900.0) * 14.0 + pow(s, 60.0) * 0.5 + pow(s, 7.0) * 0.18);
  float ang = atan(d.x, d.z);
  vec2 cuv = d.xz / (y + 0.2) * 1.4 + vec2(3.0, 1.0);
  float cl = smoothstep(0.48, 0.78, fbm(cuv * 1.3));
  vec3 cloud = mix(vec3(1.0, 0.97, 0.92), vec3(0.62, 0.68, 0.8), smoothstep(0.55, 0.9, fbm(cuv * 2.6 + 7.0)) * 0.7);
  c = mix(c, cloud, cl * smoothstep(0.03, 0.3, y) * 0.92);
  float far = 0.035 + 0.12 * fbm(vec2(ang * 2.2, 3.0)), near = 0.0 + 0.085 * fbm(vec2(ang * 4.0 + 5.0, 9.0));
  vec3 farC = mix(vec3(0.42, 0.55, 0.68), hor, 0.55), nearC = mix(vec3(0.24, 0.36, 0.34), hor, 0.35);
  c = mix(c, farC, smoothstep(far + 0.004, far - 0.004, y));
  c = mix(c, nearC, smoothstep(near + 0.004, near - 0.004, y));
  c = mix(c, vec3(0.42, 0.5, 0.36), smoothstep(0.0, -0.25, y) * 0.8);
  gl_FragColor = vec4(c, 1.0);
}`

export const makeSky = (radius: number) => new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sun: { value: SUN } },
  vertexShader: "varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: frag,
}))
