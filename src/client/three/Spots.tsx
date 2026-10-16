import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import * as THREE from "three";
import { SPACES, SPACE_LABEL, spotPoint } from "./coords";

// Hit areas are never drawn (the raycaster still finds hidden meshes), so they share one geometry and material.
const HIT_GEO = new THREE.CircleGeometry(1.5, 24);
const HIT_MAT = new THREE.MeshBasicMaterial();
const HIT_AT = new Map(SPACES.map((s) => [s.id, spotPoint(s.id).setY(spotPoint(s.id).y + 0.02)]));

/** Invisible hit areas over every space: hover for the space's rule, tap to pick it when a card asks. */
export function Spots({ pickable, onPick, traps }: { pickable?: string[]; onPick?: (s: string) => void; traps: { space: string; title: string }[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const pick = useMemo(() => new Set(pickable ?? []), [pickable]);
  useCursor(!!hover && pick.has(hover));
  return (
    <>
      {SPACES.map((s) => (
        <mesh
          key={s.id}
          position={HIT_AT.get(s.id)}
          rotation-x={-Math.PI / 2}
          geometry={HIT_GEO}
          material={HIT_MAT}
          visible={false}
          onPointerOver={(e) => (e.stopPropagation(), setHover(s.id))}
          onPointerOut={() => setHover((h) => (h === s.id ? null : h))}
          onClick={(e) => {
            if (!pick.has(s.id)) return;
            e.stopPropagation();
            onPick?.(s.id);
          }}
        />
      ))}
      {[...pick].map((id) => (
        <PickGlow key={id} space={id} hot={hover === id} />
      ))}
      {traps.map((t, i) => (
        <Trap key={`${t.space}-${i}`} space={t.space} title={t.title} />
      ))}
      {hover && <SpaceTip id={hover} picking={pick.has(hover)} />}
    </>
  );
}

function SpaceTip({ id, picking }: { id: string; picking: boolean }) {
  const s = SPACES.find((x) => x.id === id);
  if (!s) return null;
  const name = SPACE_LABEL[s.type] ?? s.type;
  const text = s.text?.includes("—") ? s.text.split("—").slice(1).join("—").trim() : s.type === "star" ? s.text : undefined;
  const p = spotPoint(id);
  return (
    <Html position={[p.x, p.y + 3.2, p.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className="space-tip">
        <div className="space-tip-name">
          {s.color && <span className={`dot dot-${s.color}`} />}
          {name}
        </div>
        {text && <div className="space-tip-text">{text}</div>}
        {picking && <div className="space-tip-pick">Tap to pick this space</div>}
      </div>
    </Html>
  );
}

function PickGlow({ space, hot }: { space: string; hot: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const p = spotPoint(space);
  const beam = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uHot: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uHot;
          void main(){ float a = (1.0 - vUv.y) * (0.45 + 0.25 * sin(uTime * 4.0 + vUv.y * 10.0));
            vec3 c = mix(vec3(0.3, 0.9, 1.0), vec3(1.0, 0.9, 0.3), uHot);
            gl_FragColor = vec4(c * a * (1.0 + uHot), 1.0); }`,
      }),
    [],
  );
  useFrame(({ clock }) => {
    beam.uniforms.uTime.value = clock.elapsedTime;
    beam.uniforms.uHot.value += ((hot ? 1 : 0) - beam.uniforms.uHot.value) * 0.2;
    if (ref.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.08 + (hot ? 0.15 : 0);
      ref.current.scale.set(s, 1, s);
    }
  });
  return (
    <group ref={ref} position={[p.x, p.y + 0.03, p.z]}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.15, 1.45, 48]} />
        <meshBasicMaterial color={hot ? "#ffe14d" : "#4de8ff"} toneMapped={false} />
      </mesh>
      <mesh position-y={1.6} material={beam}>
        <cylinderGeometry args={[1.3, 1.3, 3.2, 32, 1, true]} />
      </mesh>
    </group>
  );
}

/** A trap someone set: a spinning warning sign over the space. */
function Trap({ space, title }: { space: string; title: string }) {
  const ref = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const p = spotPoint(space);
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.6);
    s.lineTo(0.55, -0.35);
    s.lineTo(-0.55, -0.35);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.03, bevelSegments: 2 });
  }, []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 1.4;
    ref.current.position.y = p.y + 2.9 + Math.sin(clock.elapsedTime * 3) * 0.12;
  });
  return (
    <group ref={ref} position={[p.x + 0.9, p.y + 2.9, p.z - 0.6]} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
      <mesh geometry={shape}>
        <meshStandardMaterial color="#ffcc00" emissive="#ff8800" emissiveIntensity={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.05, 0.13]}>
        <boxGeometry args={[0.09, 0.4, 0.02]} />
        <meshBasicMaterial color="#1a0d00" />
      </mesh>
      <mesh position={[0, -0.32 + 0.1, 0.13]}>
        <boxGeometry args={[0.09, 0.09, 0.02]} />
        <meshBasicMaterial color="#1a0d00" />
      </mesh>
      {hover && (
        <Html center position={[0, 1, 0]} style={{ pointerEvents: "none" }}>
          <div className="space-tip">
            <div className="space-tip-name">⚠️ Trap</div>
            <div className="space-tip-text">{title}</div>
          </div>
        </Html>
      )}
    </group>
  );
}
