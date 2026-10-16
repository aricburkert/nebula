import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Hud, PerspectiveCamera, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Director, DirectorSnapshot } from "./director";
import { dieFace, imageTexture } from "./textures";
import { useAsset } from "./useAsset";
import { useTheme } from "./theme";
import { pawnColor } from "./coords";
import { sfx } from "../sfx";

/**
 * Dice and the spinner live in a screen-space layer over the board, so they're always in view
 * wherever the camera is: they tumble in, land on the server's result, then clear away.
 */
export function DiceHud({ director, snap, pawnOf, priority }: { director: Director; snap: DirectorSnapshot; pawnOf: (id: string) => string; priority: number }) {
  return (
    <Hud renderPriority={priority}>
      <PerspectiveCamera makeDefault position={[0, 0, 12]} fov={40} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[3, 6, 8]} intensity={1.6} />
      <directionalLight position={[-6, -2, 4]} intensity={0.5} color="#c9a0ff" />
      {snap.roll && <Dice key={snap.roll.id} roll={snap.roll} director={director} color={pawnColor(pawnOf(snap.roll.player))} />}
      {snap.spin && <Spinner key={snap.spin.id} spin={snap.spin} director={director} />}
    </Hud>
  );
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

function useLayout() {
  const { size } = useThree();
  // Visible half-size of the HUD plane at z=0 (camera at z=12, fov 40).
  const halfH = 12 * Math.tan((20 * Math.PI) / 180);
  const halfW = halfH * (size.width / size.height);
  return { halfW, halfH, small: size.width < 700 };
}

function Dice({ roll, director, color }: { roll: NonNullable<DirectorSnapshot["roll"]>; director: Director; color: string }) {
  const { halfW, halfH, small } = useLayout();
  const start = useRef(director.clock);
  const n = roll.dice.length;
  const size = small ? 1.1 : 1.35;
  const gap = size * 1.35;
  const dice = useMemo(
    () =>
      roll.dice.map((v, i) => {
        const others = [1, 2, 3, 4, 5, 6].filter((x) => x !== v);
        // Box faces: +x, -x, +y, -y, +z (toward the camera, the result), -z.
        const faces = [others[0], others[1], others[2], others[3], v, others[4] ?? 6];
        const mats = faces.map((f) => new THREE.MeshStandardMaterial({ map: dieFace(f, color === "#f2f2f2" ? "#5b1fb0" : "#1a1030"), roughness: 0.3, metalness: 0.05 }));
        const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const finalQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15 * (Math.random() - 0.5), 0.3 * (Math.random() - 0.5), 0.25 * (Math.random() - 0.5)));
        return { mats, axis, finalQ, turns: 3 + Math.random() * 2, x: (i - (n - 1) / 2) * gap, delay: i * 0.06 };
      }),
    [roll, n, gap, color],
  );
  // A real box (six material groups, +z toward the camera); drei's RoundedBox only has caps and sides.
  const geo = useMemo(() => new RoundedBoxGeometry(size, size, size, 4, size * 0.16), [size]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const hit = useRef(0);
  useEffect(() => sfx.diceShake(), []);
  useFrame(() => {
    const t = director.clock - start.current;
    const y0 = small ? -halfH * 0.05 : -halfH * 0.12;
    dice.forEach((d, i) => {
      const g = refs.current[i];
      if (!g) return;
      const k = Math.max(0, Math.min(1, (t - d.delay) / 1.05));
      const fromX = halfW + 2;
      const x = fromX + (d.x - fromX) * easeOut(k);
      const bounce = Math.abs(Math.sin(k * Math.PI * 2.5)) * Math.pow(1 - k, 2) * 3.2;
      const out = Math.max(0, t - 2.6);
      g.position.set(x, y0 + bounce - out * out * 30, k < 1 ? -1 + k : 0);
      const spinQ = new THREE.Quaternion().setFromAxisAngle(d.axis, d.turns * Math.PI * 2 * easeOut(k));
      const settle = Math.max(0, Math.min(1, (k - 0.55) / 0.45));
      g.quaternion.slerpQuaternions(spinQ, d.finalQ, settle * settle * (3 - 2 * settle));
      const pop = k >= 1 ? 1 + Math.max(0, 0.2 - (t - d.delay - 1.05)) * 0.8 : 1;
      g.scale.setScalar(pop);
    });
    if (t > 1.05 && hit.current === 0) {
      hit.current = 1;
      sfx.diceHit(n);
    }
  });
  return (
    <>
      {dice.map((d, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)}>
          <mesh geometry={geo} material={d.mats} />
        </group>
      ))}
    </>
  );
}

function Spinner({ spin, director }: { spin: NonNullable<DirectorSnapshot["spin"]>; director: Director }) {
  const { halfH, small } = useLayout();
  const theme = useTheme();
  const tex = useAsset(() => imageTexture(theme.spinner, theme.spinnerScale), `spinner:${theme.id}`);
  const start = useRef(director.clock);
  const board = useRef<THREE.Group>(null);
  const arrow = useRef<THREE.Group>(null);
  const lastSeg = useRef(0);
  const stopped = useRef(false);
  const turns = useMemo(() => 4 + Math.floor(Math.random() * 2), []);
  // Segment i spans 45i..45(i+1) degrees clockwise from 12 o'clock; land in its middle (with a little wobble).
  const target = useMemo(() => -((spin.segment * 45 + 22.5 + (Math.random() - 0.5) * 20) * Math.PI) / 180, [spin.segment]);
  const arrowShape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 2.05);
    s.lineTo(0.42, 1.25);
    s.lineTo(0.16, 1.3);
    s.lineTo(0.12, -0.7);
    s.lineTo(-0.12, -0.7);
    s.lineTo(-0.16, 1.3);
    s.lineTo(-0.42, 1.25);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
  }, []);
  const faceMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.6 }), []);
  if (tex && faceMat.map !== tex) {
    faceMat.map = tex;
    faceMat.needsUpdate = true;
  }
  const scale = small ? 0.62 : 0.8;
  useFrame(() => {
    const t = director.clock - start.current;
    if (!board.current || !arrow.current) return;
    const rise = easeOut(Math.min(1, t / 0.45));
    const leave = Math.max(0, t - 3.9);
    board.current.position.set(0, -halfH * 1.6 + rise * halfH * 1.55 - leave * leave * 40, 0);
    board.current.rotation.x = -0.5 + rise * 0.28;
    const k = Math.max(0, Math.min(1, (t - 0.35) / 2.4));
    const e = 1 - Math.pow(1 - k, 4);
    const angle = target + (1 - e) * turns * Math.PI * 2; // clockwise, slowing onto the result
    arrow.current.rotation.z = angle;
    const seg = Math.floor(-angle / (Math.PI / 4));
    if (seg !== lastSeg.current && k < 1) {
      lastSeg.current = seg;
      sfx.tick();
    }
    if (k >= 1 && !stopped.current) {
      stopped.current = true;
      sfx.spinStop();
    }
  });
  return (
    <group ref={board} scale={scale}>
      <RoundedBox args={[5.4, 5.4, 0.35]} radius={0.25} smoothness={4}>
        <meshStandardMaterial color="#2a1250" roughness={0.4} metalness={0.3} />
      </RoundedBox>
      <mesh position-z={0.18} material={faceMat}>
        <planeGeometry args={[5, 5]} />
      </mesh>
      <group ref={arrow} position-z={0.3}>
        <mesh geometry={arrowShape}>
          <meshStandardMaterial color="#ff2a5f" roughness={0.25} metalness={0.3} emissive="#ff0040" emissiveIntensity={0.25} />
        </mesh>
      </group>
      <mesh position-z={0.42} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.28, 0.28, 0.12, 24]} />
        <meshStandardMaterial color="#ffd60a" metalness={0.7} roughness={0.2} />
      </mesh>
    </group>
  );
}
