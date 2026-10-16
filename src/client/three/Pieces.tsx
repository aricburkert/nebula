import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import art from "./boardArt.json";
import { ART_H, ART_W, PX, TRACK_H, toWorld } from "./coords";
import { cutOut, imageTexture, type CutOut } from "./textures";
import { useAsset } from "./useAsset";
import { fx } from "./Particles";

/**
 * The board's illustrations, standing up off the board like a pop-up book: die-cut cardboard pieces
 * with a white border and real thickness, each with its own little idle animation.
 */
type Box = [number, number, number, number];
const PIECE = art.pieces as unknown as Record<string, { box: Box }>;

interface Idle {
  (t: number, g: THREE.Group, ctx: { base: THREE.Vector3; w: number; h: number; lean: number }): void;
}
interface PieceCfg {
  name: string;
  /** Tilt back from vertical, radians. */
  lean: number;
  /** Lift above the board. */
  lift?: number;
  scale?: number;
  /** Nudge in art px. */
  shift?: [number, number];
  idle?: Idle;
}

const sway = (speed: number, amt: number, phase = 0): Idle => (t, g) => {
  g.rotation.z = Math.sin(t * speed + phase) * amt;
};
const bob = (speed: number, amt: number, phase = 0): Idle => (t, g) => {
  g.position.y = Math.sin(t * speed + phase) * amt;
};
const both = (...fs: Idle[]): Idle => (t, g, c) => fs.forEach((f) => f(t, g, c));

/** A point on a piece's art (0..1 across, 0..1 down) in world space, for particle effects. */
const artPoint = (g: THREE.Object3D, w: number, h: number, u: number, v: number) => g.localToWorld(new THREE.Vector3((u - 0.5) * w, (1 - v) * h, 0.05));

let fireAt = 0;
let smokeAt = 0;
let emberAt = 0;

const PIECES: PieceCfg[] = [
  { name: "hook", lean: 0.12, idle: sway(1.1, 0.05) },
  {
    name: "cannon",
    lean: 0.18,
    idle: (t, g, { w, h }) => {
      // Every few seconds the cannon kicks back and puffs smoke.
      const k = t % 7;
      g.position.x = k < 0.5 ? -Math.sin((k / 0.5) * Math.PI) * 0.35 : 0;
      g.rotation.z = k < 0.5 ? Math.sin((k / 0.5) * Math.PI) * 0.05 : 0;
      if (k < 0.1 && t - smokeAt > 1) {
        smokeAt = t;
        const at = artPoint(g, w, h, 0.78, 0.4);
        fx.burst({ at, count: 26, color: ["#ffffff", "#dfe6f0", "#c9d2de"], speed: [0.5, 1.8], dir: new THREE.Vector3(1.4, 0.6, 0), life: [0.9, 1.8], size: [0.5, 1.1], drag: 1.2, gravity: -0.4, additive: false });
        fx.burst({ at, count: 12, color: ["#ffcf3a", "#ff7a1a"], speed: [1, 3], dir: new THREE.Vector3(2, 0.4, 0), life: [0.2, 0.45], size: [0.3, 0.6] });
      }
    },
  },
  { name: "bee-top", lean: 0.32, lift: 1.1, scale: 0.85, shift: [0, 140], idle: both(bob(2.6, 0.35), sway(5.5, 0.04)) },
  { name: "bee-bottom", lean: 0.32, lift: 0.9, scale: 0.9, idle: both(bob(2.4, 0.35, 1), sway(5, 0.04, 1)) },
  { name: "boat", lean: 1.15, lift: 0.04, idle: (t, g) => ((g.rotation.z = Math.sin(t * 1.3) * 0.05), (g.position.y = Math.sin(t * 1.7) * 0.04)) },
  {
    name: "dragon",
    lean: 0.22,
    lift: 0.4,
    idle: (t, g, { w, h }) => {
      g.position.y = Math.sin(t * 1.5) * 0.25;
      const breathe = 1 + Math.sin(t * 2.2) * 0.025;
      g.scale.set(1 / breathe, breathe, 1);
      const k = t % 9;
      if (k < 1.2 && t - fireAt > 0.06) {
        fireAt = t;
        fx.burst({ at: artPoint(g, w, h, 0.1, 0.4), count: 8, color: ["#ffe14d", "#ff9a1a", "#ff3b1a"], speed: [2.5, 4.5], dir: new THREE.Vector3(-3.2, -0.5, 0.6), spread: 0.4, life: [0.35, 0.7], size: [0.4, 0.9], drag: 0.8, gravity: -1.5 });
      }
    },
  },
  { name: "canoe", lean: 0.28, idle: (t, g) => ((g.rotation.z = Math.sin(t * 2.1) * 0.07), (g.position.y = Math.abs(Math.sin(t * 2.1)) * 0.12)) },
  {
    name: "recovery",
    lean: 0.2,
    idle: (t, g, { w, h }) => {
      if (t - emberAt > 0.12) {
        emberAt = t;
        fx.burst({ at: artPoint(g, w, h, 0.1, 0.55), count: 2, color: ["#ffd23a", "#ff6a1a"], speed: [0.2, 0.6], dir: new THREE.Vector3(0, 1.4, 0), spread: 0.5, life: [0.6, 1.2], size: [0.12, 0.25], drag: 0.5 });
      }
    },
  },
  { name: "troll", lean: 0.16, idle: both(sway(1.6, 0.05), bob(3.2, 0.05)) },
  { name: "nebula-woman", lean: 0.2, scale: 0.78, shift: [-20, 80], idle: both(sway(2.4, 0.12), bob(1.8, 0.15)) },
  { name: "nebula-man", lean: 0.2, scale: 0.78, shift: [0, 60], idle: both(sway(2.0, 0.1, 2), bob(1.6, 0.15, 1)) },
  { name: "start-text", lean: 0.95, lift: 0.06, idle: (t, g) => g.scale.setScalar(1 + Math.sin(t * 2) * 0.025) },
  { name: "finish-text", lean: 0.6, lift: 0.06, shift: [0, -250], idle: (t, g) => g.scale.setScalar(1 + Math.sin(t * 2 + 1) * 0.025) },
];

export function Pieces({ intro = 0, flatTitle = false }: { intro?: number; flatTitle?: boolean }) {
  return (
    <>
      {PIECES.map((p, i) => (
        <Standee key={p.name} cfg={p} delay={intro + 0.25 + i * 0.09} />
      ))}
      <Title delay={intro + 0.3} flat={flatTitle} />
      <Vortex />
    </>
  );
}

function useCut(name: string, opts?: Parameters<typeof cutOut>[3]) {
  const [, , w, h] = PIECE[name].box;
  return useAsset(() => cutOut(`/assets/board3d/pieces/${name}.svg`, w, h, opts), `${name}:${JSON.stringify(opts)}`);
}

/** Layers of the cut-out stacked behind each other give the piece its cardboard thickness. */
function CardboardLayers({ cut, w, h, layers = 4, step = 0.018 }: { cut: CutOut; w: number; h: number; layers?: number; step?: number }) {
  const mats = useMemo(() => {
    const face = new THREE.MeshStandardMaterial({ map: cut.face, alphaTest: 0.5, roughness: 0.75, side: THREE.FrontSide });
    const edge = new THREE.MeshStandardMaterial({ map: cut.edge, alphaTest: 0.5, roughness: 0.9 });
    const back = new THREE.MeshStandardMaterial({ map: cut.edge, alphaTest: 0.5, roughness: 0.9, side: THREE.BackSide, color: "#efe9df" });
    return { face, edge, back };
  }, [cut]);
  const geo = useMemo(() => new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), [w, h]);
  return (
    <>
      <mesh geometry={geo} material={mats.face} castShadow />
      {Array.from({ length: layers }, (_, k) => (
        <mesh key={k} geometry={geo} material={mats.edge} position-z={-(k + 1) * step} />
      ))}
      <mesh geometry={geo} material={mats.back} position-z={-(layers + 1) * step} castShadow />
    </>
  );
}

const easeOutBack = (x: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function Standee({ cfg, delay }: { cfg: PieceCfg; delay: number }) {
  const cut = useCut(cfg.name);
  const hinge = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  const [bx, by, bw, bh] = PIECE[cfg.name].box;
  const s = (cfg.scale ?? 1) * PX;
  const [dx, dy] = cfg.shift ?? [0, 0];
  const base = useMemo(() => toWorld(bx + bw / 2 + dx, by + bh + dy, (cfg.lift ?? 0) + TRACK_H * 0.5), [bx, by, bw, bh, dx, dy, cfg.lift]);

  useFrame(({ clock }) => {
    if (!cut || !hinge.current || !inner.current) return;
    if (born.current === null) born.current = clock.elapsedTime;
    const t = clock.elapsedTime - born.current - delay;
    // Pop up from flat, like opening a pop-up book.
    const k = Math.max(0, Math.min(1, t / 0.75));
    const up = easeOutBack(k);
    hinge.current.rotation.x = -Math.PI / 2 + (Math.PI / 2 - cfg.lean) * up;
    hinge.current.visible = t > -0.05;
    cfg.idle?.(clock.elapsedTime, inner.current, { base, w: cut.width * s, h: cut.height * s, lean: cfg.lean });
  });

  if (!cut) return null;
  const w = cut.width * s;
  const h = cut.height * s;
  // Sink the white border and padding into the board so the art's feet touch it.
  const sink = (cut.border + 14) * s * 0.85;
  return (
    <group position={base}>
      <group ref={hinge} visible={false}>
        <group ref={inner}>
          <group position-y={-sink}>
            <CardboardLayers cut={cut} w={w} h={h} />
          </group>
        </group>
      </group>
    </group>
  );
}

/** The game's title, floating over the middle of the board. */
function Title({ delay, flat }: { delay: number; flat: boolean }) {
  const cut = useCut("title", { border: 18, edgeColor: "#3b0a6e" });
  const ref = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  const [bx, by, bw, bh] = PIECE.title.box;
  useFrame(({ clock }) => {
    if (!ref.current || !cut) return;
    if (born.current === null) born.current = clock.elapsedTime;
    const t = clock.elapsedTime - born.current - delay;
    const k = easeOutBack(Math.max(0, Math.min(1, t / 1.1)));
    const T = clock.elapsedTime;
    // In a game it hovers low and nearly flat so it doesn't hide the spaces behind it.
    ref.current.position.y = (flat ? 0.5 + k * 0.7 : 0.6 + k * 1.8) + Math.sin(T * 0.9) * (flat ? 0.12 : 0.22);
    ref.current.rotation.x = -Math.PI / 2 + (Math.PI / 2 - (flat ? 1.22 : 0.62)) * k;
    ref.current.rotation.y = Math.sin(T * 0.45) * 0.06;
    ref.current.rotation.z = Math.sin(T * 0.6) * 0.025;
    ref.current.visible = t > 0;
  });
  if (!cut) return null;
  const w = cut.width * PX;
  const h = cut.height * PX;
  const c = toWorld(bx + bw / 2, by + bh * 0.9, 0);
  return (
    <group position={[c.x, 0, c.z]}>
      <group ref={ref} visible={false}>
        <group position-y={-h * 0.15}>
          <CardboardLayers cut={cut} w={w} h={h} layers={7} step={0.03} />
        </group>
      </group>
    </group>
  );
}

/** The NEBULA: the printed vortex, swirling. */
function Vortex() {
  const [bx, by, bw, bh] = PIECE.vortex.box;
  const tex = useAsset(() => imageTexture(`/assets/board3d/pieces/vortex.svg`, 1.5), "vortex");
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uMap: { value: null }, uTime: { value: 0 }, uAspect: { value: bh / bw } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `
          varying vec2 vUv; uniform sampler2D uMap; uniform float uTime; uniform float uAspect;
          void main(){
            vec2 c = vec2(0.5, 0.52);
            vec2 q = (vUv - c) * vec2(1.0, uAspect);
            float r = length(q);
            float a = -uTime * (0.9 / (0.12 + r * 3.0));
            float s = sin(a), co = cos(a);
            vec2 rq = mat2(co, -s, s, co) * q;
            vec2 uv = c + rq / vec2(1.0, uAspect);
            vec4 col = texture2D(uMap, uv);
            // keep the printed outline still so the edge stays put; swirl the inside
            vec4 still = texture2D(uMap, vUv);
            float inner = smoothstep(0.42, 0.18, r);
            vec4 o = mix(still, col, inner);
            o.a = still.a;
            float glow = 0.25 + 0.15 * sin(uTime * 2.0 + r * 20.0);
            o.rgb += o.rgb * glow * inner;
            gl_FragColor = o;
          }`,
      }),
    [bw, bh],
  );
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }, dt) => {
    mat.uniforms.uTime.value += dt;
    if (light.current) light.current.intensity = 14 + Math.sin(clock.elapsedTime * 2.2) * 5;
  });
  if (tex && mat.uniforms.uMap.value !== tex) mat.uniforms.uMap.value = tex;
  const c = toWorld(bx + bw / 2, by + bh / 2, 0.03);
  return (
    <group position={c}>
      {tex && (
        <mesh rotation-x={-Math.PI / 2} material={mat} renderOrder={2}>
          <planeGeometry args={[bw * PX, bh * PX]} />
        </mesh>
      )}
      <pointLight ref={light} color="#c040ff" position={[0, 1.5, 0]} distance={9} decay={1.6} />
    </group>
  );
}

export const VORTEX_CENTER = (() => {
  const [bx, by, bw, bh] = PIECE.vortex.box;
  return toWorld(bx + bw / 2, by + bh * 0.52, 0.05);
})();
export const VORTEX_SIZE = { w: PIECE.vortex.box[2] * PX, h: PIECE.vortex.box[3] * PX };
void ART_W;
void ART_H;
