import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * One pooled particle system for every burst in the game: dust when a pawn lands, sparkles on a warp,
 * smoke from the cannon, dragon fire, confetti. Call `fx.burst(...)` from anywhere.
 */
const MAX = 3000;

export interface BurstOpts {
  at: THREE.Vector3;
  count?: number;
  color?: string | string[];
  /** Initial speed range. */
  speed?: [number, number];
  /** Bias added to every particle's velocity. */
  dir?: THREE.Vector3;
  /** 0 = straight along dir, 1 = any direction. */
  spread?: number;
  life?: [number, number];
  size?: [number, number];
  gravity?: number;
  drag?: number;
  /** Square confetti instead of soft glowing dots. */
  confetti?: boolean;
  /** Ring outward in the ground plane (dust). */
  ring?: boolean;
  additive?: boolean;
}

class Pool {
  pos = new Float32Array(MAX * 3);
  vel = new Float32Array(MAX * 3);
  col = new Float32Array(MAX * 3);
  size = new Float32Array(MAX);
  age = new Float32Array(MAX).fill(1);
  life = new Float32Array(MAX).fill(1);
  grav = new Float32Array(MAX);
  drag = new Float32Array(MAX);
  kind = new Float32Array(MAX);
  next = 0;
  /** Color, size and kind only change when a burst starts, so they're only re-sent to the GPU then. */
  dirty = false;
  private c = new THREE.Color();
  private zero = new THREE.Vector3();

  burst(o: BurstOpts) {
    const n = o.count ?? 20;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? "#ffffff"];
    const [s0, s1] = o.speed ?? [1, 3];
    const [l0, l1] = o.life ?? [0.5, 1];
    const [z0, z1] = o.size ?? [0.15, 0.35];
    const spread = o.spread ?? 1;
    const dir = o.dir ?? this.zero;
    this.dirty = true;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      let vx: number, vy: number, vz: number;
      if (o.ring) {
        const a = Math.random() * Math.PI * 2;
        vx = Math.cos(a);
        vy = 0.15 + Math.random() * 0.3;
        vz = Math.sin(a);
      } else {
        // random unit vector
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        vx = r * Math.cos(a) * spread;
        vy = u * spread;
        vz = r * Math.sin(a) * spread;
      }
      const sp = s0 + Math.random() * (s1 - s0);
      this.pos[i * 3] = o.at.x;
      this.pos[i * 3 + 1] = o.at.y;
      this.pos[i * 3 + 2] = o.at.z;
      this.vel[i * 3] = vx * sp + dir.x;
      this.vel[i * 3 + 1] = vy * sp + dir.y;
      this.vel[i * 3 + 2] = vz * sp + dir.z;
      this.c.set(colors[Math.floor(Math.random() * colors.length)]);
      this.col[i * 3] = this.c.r;
      this.col[i * 3 + 1] = this.c.g;
      this.col[i * 3 + 2] = this.c.b;
      this.size[i] = z0 + Math.random() * (z1 - z0);
      this.age[i] = 0;
      this.life[i] = l0 + Math.random() * (l1 - l0);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      this.kind[i] = o.confetti ? 1 : o.additive === false ? 2 : 0;
    }
  }
}

export const fx = new Pool();

const vert = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float fade;
  attribute float kind;
  varying vec3 vColor;
  varying float vFade;
  varying float vKind;
  uniform float uScale;
  void main() {
    vColor = color;
    vFade = fade;
    vKind = kind;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vFade;
  varying float vKind;
  void main() {
    if (vFade <= 0.0) discard;
    vec2 p = gl_PointCoord - 0.5;
    float a;
    if (vKind > 0.5 && vKind < 1.5) {
      // confetti: a little tumbling square
      a = step(abs(p.x), 0.42) * step(abs(p.y), 0.26);
    } else {
      a = smoothstep(0.5, 0.0, length(p));
    }
    gl_FragColor = vec4(vColor * (vKind < 0.5 ? 1.6 : 1.0), a * vFade);
  }
`;

export function Particles() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(fx.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(fx.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(fx.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("fade", new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("kind", new THREE.BufferAttribute(fx.kind, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 500);
    return g;
  }, []);
  const glow = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 600 } },
      }),
    [],
  );
  const solid = useMemo(() => {
    const m = glow.clone();
    m.blending = THREE.NormalBlending;
    return m;
  }, [glow]);
  const solidGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    for (const k of ["position", "color", "size", "kind"]) g.setAttribute(k, geo.getAttribute(k));
    g.setAttribute("fade", new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = geo.boundingSphere;
    return g;
  }, [geo]);
  const ref = useRef(0);

  useFrame(({ size, camera }, dt) => {
    dt = Math.min(dt, 0.05);
    const fadeGlow = geo.getAttribute("fade") as THREE.BufferAttribute;
    const fadeSolid = solidGeo.getAttribute("fade") as THREE.BufferAttribute;
    const scale = size.height / (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));
    glow.uniforms.uScale.value = scale;
    solid.uniforms.uScale.value = scale;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      const t = fx.age[i] / fx.life[i];
      if (t >= 1) {
        (fadeGlow.array as Float32Array)[i] = 0;
        (fadeSolid.array as Float32Array)[i] = 0;
        continue;
      }
      alive++;
      fx.age[i] += dt;
      const d = Math.exp(-fx.drag[i] * dt);
      fx.vel[i * 3] *= d;
      fx.vel[i * 3 + 1] = fx.vel[i * 3 + 1] * d - fx.grav[i] * dt;
      fx.vel[i * 3 + 2] *= d;
      fx.pos[i * 3] += fx.vel[i * 3] * dt;
      fx.pos[i * 3 + 1] += fx.vel[i * 3 + 1] * dt;
      fx.pos[i * 3 + 2] += fx.vel[i * 3 + 2] * dt;
      const f = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      const glowing = fx.kind[i] === 0;
      (fadeGlow.array as Float32Array)[i] = glowing ? f : 0;
      (fadeSolid.array as Float32Array)[i] = glowing ? 0 : Math.min(1, f * 1.5);
    }
    const before = ref.current;
    ref.current = alive;
    if (alive === 0 && before === 0) return;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    if (fx.dirty) {
      fx.dirty = false;
      for (const k of ["color", "size", "kind"]) (geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    }
    fadeGlow.needsUpdate = true;
    fadeSolid.needsUpdate = true;
  });

  return (
    <>
      <points geometry={geo} material={glow} frustumCulled={false} renderOrder={10} />
      <points geometry={solidGeo} material={solid} frustumCulled={false} renderOrder={9} />
    </>
  );
}
