import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import art from "./boardArt.json";
import { ART_H, ART_W, BOARD_D, BOARD_W, PX, SLAB_H, TRACK_H, toWorld } from "./coords";
import { boardTexture } from "./textures";
import { useAsset } from "./useAsset";
import type { Quality } from "./quality";

const shapesOf = (d: string) => {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
  return data.paths.flatMap((p) => p.toShapes());
};

/** Lays a geometry built in art pixels (x right, y down) onto the board: 1 unit per 100 px, centered, y up. */
function toBoardSpace(g: THREE.BufferGeometry, lift: number) {
  g.rotateX(Math.PI / 2);
  g.translate(-ART_W / 2, lift / PX, -ART_H / 2);
  g.scale(PX, PX, PX);
  return g;
}

function planarUVs(g: THREE.BufferGeometry) {
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / ART_W, 1 - pos.getY(i) / ART_H);
  uv.needsUpdate = true;
}

export function Board3D({ quality }: { quality: Quality }) {
  const tex = useAsset(() => boardTexture("/assets/board3d/flat.svg", quality === "high" ? 6144 : 4096), `flat:${quality}`);

  const track = useMemo(() => {
    const bevel = 4;
    const g = new THREE.ExtrudeGeometry(shapesOf(art.shapes.track), {
      depth: TRACK_H / PX,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 40,
    });
    planarUVs(g);
    toBoardSpace(g, TRACK_H - bevel * PX);
    g.computeVertexNormals();
    return g;
  }, []);

  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 }), []);
  const trackSide = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.7 }), []);
  if (tex && topMat.map !== tex) {
    topMat.map = tex;
    topMat.needsUpdate = true;
  }

  return (
    <group>
      {/* the board itself: a thick game board floating in space */}
      <RoundedBox args={[BOARD_W + 0.6, SLAB_H, BOARD_D + 0.6]} radius={0.28} smoothness={4} position={[0, -SLAB_H / 2 - 0.001, 0]} receiveShadow castShadow>
        <meshStandardMaterial color="#1a0f33" roughness={0.45} metalness={0.3} />
      </RoundedBox>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]} receiveShadow material={topMat} visible={!!tex}>
        <planeGeometry args={[BOARD_W, BOARD_D]} />
      </mesh>
      {/* neon trim under the edge */}
      <RoundedBox args={[BOARD_W + 0.9, 0.12, BOARD_D + 0.9]} radius={0.06} smoothness={2} position={[0, -SLAB_H + 0.12, 0]}>
        <meshBasicMaterial color="#ff3fd0" toneMapped={false} />
      </RoundedBox>
      <Underglow />

      <mesh geometry={track} material={[topMat, trackSide]} castShadow receiveShadow visible={!!tex} />
      <Water d={art.shapes.river} />
      <Water d={art.shapes.rapids} fast />
      {art.stars.map((s, i) => (
        <Star key={i} d={s.d!} box={s.box} phase={i * 1.7} />
      ))}
      {art.shields.map((s, i) => (
        <Shield key={i} d={s.d!} plus={s.plus!} box={s.box} phase={i * 2.1} />
      ))}
    </group>
  );
}

function Underglow() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `
          varying vec2 vUv; uniform float uTime;
          void main(){
            vec2 p = (vUv - 0.5) * vec2(2.0, 2.0);
            float d = length(p * vec2(1.0, 1.0));
            float a = smoothstep(1.0, 0.25, d) * (0.55 + 0.1 * sin(uTime * 0.8));
            vec3 c = mix(vec3(0.55, 0.1, 1.0), vec3(1.0, 0.15, 0.6), 0.5 + 0.5 * sin(uTime * 0.3 + p.x * 2.0));
            gl_FragColor = vec4(c * a * 0.55, 1.0);
          }`,
      }),
    [],
  );
  useFrame((_, dt) => (mat.uniforms.uTime.value += dt));
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -SLAB_H - 0.6, 0]} material={mat}>
      <planeGeometry args={[BOARD_W * 1.6, BOARD_D * 2.2]} />
    </mesh>
  );
}

/** The river and the rapids: the printed water with moving glints on top. */
function Water({ d, fast }: { d: string; fast?: boolean }) {
  const geo = useMemo(() => toBoardSpace(new THREE.ShapeGeometry(shapesOf(d), 24), 0.012), [d]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uSpeed: { value: fast ? 2.2 : 0.8 } },
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `
          varying vec3 vW; uniform float uTime; uniform float uSpeed;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
            return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
          void main(){
            vec2 p = vW.xz * 1.4;
            float t = uTime * uSpeed;
            float a = n(p + vec2(t * 0.6, t * 0.25)) + 0.5 * n(p * 2.3 - vec2(t * 0.4, -t * 0.7));
            float glint = smoothstep(1.05, 1.32, a);
            float ripple = 0.5 + 0.5 * sin(vW.x * 3.0 + vW.z * 2.0 + t * 2.0 + a * 4.0);
            float alpha = glint * 0.55 + ripple * 0.06;
            gl_FragColor = vec4(vec3(0.85, 0.97, 1.0), alpha);
          }`,
      }),
    [fast],
  );
  useFrame((_, dt) => (mat.uniforms.uTime.value += dt));
  return <mesh geometry={geo} material={mat} renderOrder={1} />;
}

function centered(shapes: THREE.Shape[], depth: number, bevel = 3) {
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 16 });
  g.computeBoundingBox();
  const c = new THREE.Vector3();
  g.boundingBox!.getCenter(c);
  g.translate(-c.x, -c.y, -c.z);
  // SVG y points down; flip so the art reads upright when the piece stands up.
  g.scale(PX, -PX, PX);
  g.computeVertexNormals();
  return { g, center: c };
}

/** The warp stars, as spinning gold tokens hovering over their spaces. */
function Star({ d, box, phase }: { d: string; box: number[]; phase: number }) {
  const { g } = useMemo(() => centered(shapesOf(d), 16), [d]);
  const ref = useRef<THREE.Group>(null);
  const base = useMemo(() => toWorld((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, TRACK_H), [box]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    if (!ref.current) return;
    ref.current.rotation.y = t * 1.6;
    ref.current.position.y = base.y + 0.75 + Math.sin(t * 2) * 0.12;
  });
  return (
    <group ref={ref} position={base}>
      <mesh geometry={g} castShadow scale={1.35}>
        <meshStandardMaterial color="#ffc21a" emissive="#ff9a00" emissiveIntensity={0.5} metalness={0.25} roughness={0.3} />
      </mesh>
      <pointLight color="#ffcc33" intensity={2.5} distance={3} decay={2} />
    </group>
  );
}

/** Safe Zone shields, standing guard over their spaces. */
function Shield({ d, plus, box, phase }: { d: string; plus: string; box: number[]; phase: number }) {
  const { g, center } = useMemo(() => centered(shapesOf(d), 14), [d]);
  const p = useMemo(() => {
    const g2 = new THREE.ExtrudeGeometry(shapesOf(plus), { depth: 8, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 1 });
    g2.translate(-center.x, -center.y, 0);
    g2.scale(PX, -PX, PX);
    g2.computeVertexNormals();
    return g2;
  }, [plus, center]);
  const ref = useRef<THREE.Group>(null);
  const base = useMemo(() => toWorld((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, TRACK_H), [box]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    if (!ref.current) return;
    ref.current.rotation.y = Math.sin(t * 0.9) * 0.5;
    ref.current.position.y = base.y + 0.72 + Math.sin(t * 1.4) * 0.08;
  });
  return (
    <group ref={ref} position={base}>
      <group scale={1.25}>
        <mesh geometry={g} castShadow>
          <meshStandardMaterial color="#d9dee8" metalness={0.15} roughness={0.35} />
        </mesh>
        <mesh geometry={p} position-z={0.1}>
          <meshStandardMaterial color="#8e96a6" metalness={0.15} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}
