import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useCursor } from "@react-three/drei";
import * as THREE from "three";
import type { Pos } from "../../engine/types";
import { pawnColor, posSpot, spotPoint } from "./coords";
import type { Director, Running } from "./director";
import { fx } from "./Particles";
import { VORTEX_CENTER, VORTEX_SIZE } from "./Pieces";
import { cutOut, glyph } from "./textures";
import { useAsset } from "./useAsset";
import { sfx } from "../sfx";

export interface PawnInfo {
  id: string;
  pawn: string;
  name: string;
  asleep?: boolean;
  cursed?: number;
  current?: boolean;
  you?: boolean;
}

/** Live world position of every pawn, for the camera to follow. */
export const pawnWorld = new Map<string, THREE.Vector3>();

const PAWN_H = 2.9;
const PAWN_W = (PAWN_H * 300) / 525;

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

function restSlot(spot: string, k: number, n: number, t: number): THREE.Vector3 {
  if (spot === "nebula") {
    const a = t * 0.55 + (k / Math.max(1, n)) * Math.PI * 2;
    return VORTEX_CENTER.clone().add(new THREE.Vector3(Math.cos(a) * VORTEX_SIZE.w * 0.28, 0, Math.sin(a) * VORTEX_SIZE.h * 0.3));
  }
  const p = spotPoint(spot);
  if (n <= 1) return p;
  const cols = Math.min(n, 3);
  const row = Math.floor(k / cols);
  const col = k % cols;
  const inRow = Math.min(cols, n - row * cols);
  p.x += (col - (inRow - 1) / 2) * 1.15;
  p.z += (row - (Math.ceil(n / cols) - 1) / 2) * 0.85 + (col % 2) * 0.12;
  return p;
}

/** Points a walk passes through, from where the pawn stood. */
function walkPoints(from: Pos, to: Pos, path: string[]): THREE.Vector3[] {
  const pts = [spotPoint(posSpot(from))];
  for (const id of path) pts.push(spotPoint(id));
  const end = posSpot(to);
  if (path[path.length - 1] !== end) pts.push(spotPoint(end));
  return pts;
}

export function Pawns({ players, director, lobby }: { players: PawnInfo[]; director?: Director; lobby?: boolean }) {
  // Group by displayed spot so pawns sharing a space fan out.
  const order = useMemo(() => players.map((p) => p.id), [players]);
  return (
    <>
      {players.map((p, i) => (
        <Pawn key={p.id} info={p} index={i} order={order} director={director} lobby={lobby} />
      ))}
    </>
  );
}

function Pawn({ info, index, order, director, lobby }: { info: PawnInfo; index: number; order: string[]; director?: Director; lobby?: boolean }) {
  const color = pawnColor(info.pawn);
  const cut = useAsset(
    () => cutOut(`/assets/pawns/${info.pawn}.png`, 300, 525, { border: 10, scale: 1.4, edgeColor: new THREE.Color(color).multiplyScalar(0.6).getStyle() }),
    `pawn:${info.pawn}`,
  );
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const face = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const arrow = useRef<THREE.Group>(null);
  const zzz = useRef<THREE.Sprite>(null);
  const skull = useRef<THREE.Sprite>(null);
  const tag = useRef<THREE.Sprite>(null);
  const [hover, setHover] = useState(false);
  useCursor(hover);
  const st = useRef({ pos: new THREE.Vector3(), hop: -1, evId: -1, landed: false, squash: 0, born: -1 });

  const nameTex = useMemo(() => glyph(info.name, { size: 64, font: `bold 44px "Luckiest Guy", "Roboto", sans-serif`, color: "#ffffff" }), [info.name]);
  const zTex = useMemo(() => glyph("💤", { size: 96 }), []);
  const sTex = useMemo(() => glyph("☠️", { size: 96 }), []);

  const mats = useMemo(() => {
    if (!cut) return null;
    return {
      face: new THREE.MeshStandardMaterial({ map: cut.face, alphaTest: 0.5, roughness: 0.55 }),
      edge: new THREE.MeshStandardMaterial({ map: cut.edge, alphaTest: 0.5, roughness: 0.5 }),
      back: new THREE.MeshStandardMaterial({ map: cut.face, alphaTest: 0.5, roughness: 0.55, side: THREE.BackSide }),
    };
  }, [cut]);
  const geo = useMemo(() => {
    const w = cut ? (cut.width / 300) * PAWN_W : PAWN_W;
    const h = cut ? (cut.height / 525) * PAWN_H : PAWN_H;
    return new THREE.PlaneGeometry(w, h).translate(0, h / 2 + 0.14, 0);
  }, [cut]);

  useFrame(({ clock, camera }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = clock.elapsedTime;
    const s = st.current;
    if (s.born < 0) s.born = t;
    if (!root.current || !body.current || !face.current) return;

    // Where would we stand at rest?
    let restSpot = "start";
    let k = index;
    let n = order.length;
    if (director) {
      const mine = director.shown.get(info.id);
      restSpot = mine ? posSpot(mine) : "start";
      const same = order.filter((id) => {
        const p = director.shown.get(id);
        return p && posSpot(p) === restSpot;
      });
      k = Math.max(0, same.indexOf(info.id));
      n = same.length;
    }
    const rest = lobby ? lobbySlot(index, order.length) : restSlot(restSpot, k, n, t);

    const a: Running | null = director?.active ?? null;
    const moving = a && a.ev.kind === "move" && a.ev.motion.player === info.id ? a : null;
    let y = 0;
    let spin = 0;
    let scale = 1;
    if (moving && moving.ev.kind === "move" && director) {
      const m = moving.ev.motion;
      const p = director.progress(moving);
      if (s.evId !== moving.id) {
        s.evId = moving.id;
        s.hop = -1;
        s.landed = false;
        if (m.how !== "walk") sfx.whoosh();
        if (m.how === "nebula") sfx.nebula();
      }
      if (m.how === "walk") {
        const pts = walkPoints(m.from, m.to, m.path ?? []);
        const hops = pts.length - 1;
        if (hops <= 0) {
          // Blocked (the Grappling Hook): a little frustrated hop in place.
          s.pos.copy(pts[0]);
          y = Math.abs(Math.sin(p * Math.PI * 3)) * 0.3 * (1 - p);
        } else {
          const elapsed = Math.min(1, (director.clock - moving.start) / (moving.dur - 0.25));
          const x = elapsed * hops;
          const i = Math.min(hops - 1, Math.floor(x));
          const f = Math.min(1, x - i);
          s.pos.lerpVectors(pts[i], pts[i + 1], ease(f));
          y = Math.sin(Math.PI * f) * 0.95;
          spin = (f - 0.5) * 0.25;
          if (i !== s.hop) {
            if (s.hop >= 0) land(pts[i], color);
            s.hop = i;
          }
          if (elapsed >= 1 && !s.landed) {
            s.landed = true;
            land(pts[hops], color);
            s.squash = 1;
          }
        }
      } else {
        const from = m.from.kind === "nebula" ? VORTEX_CENTER.clone() : spotPoint(posSpot(m.from));
        const to = m.to.kind === "nebula" ? VORTEX_CENTER.clone() : spotPoint(posSpot(m.to));
        const dist = from.distanceTo(to);
        if (p < 0.03 && s.hop < 0) {
          s.hop = 0;
          fx.burst({ at: from.clone().setY(from.y + 0.8), count: 30, color: [color, "#ffffff", "#ffe066"], speed: [2, 5], life: [0.4, 0.9], size: [0.15, 0.35] });
        }
        if (m.how === "nebula") {
          // Fly over, then get sucked down in a spiral.
          const fly = Math.min(1, p / 0.55);
          const suck = Math.max(0, (p - 0.55) / 0.45);
          s.pos.lerpVectors(from, to, ease(fly));
          const r = (1 - suck) * 1.6;
          const ang = suck * Math.PI * 6;
          s.pos.x += Math.cos(ang) * r * suck;
          s.pos.z += Math.sin(ang) * r * suck * 0.6;
          y = Math.sin(Math.PI * fly) * (2 + dist * 0.15) * (1 - suck) + (1 - suck) * 0.3;
          spin = suck * Math.PI * 8;
          scale = 1 - suck * 0.45;
        } else if (m.how === "unnebula") {
          s.pos.lerpVectors(from, to, ease(p));
          y = Math.sin(Math.PI * p) * (2.5 + dist * 0.2);
          spin = (1 - p) * Math.PI * 4;
          scale = 0.55 + 0.45 * easeOut(Math.min(1, p * 2));
        } else {
          const big = m.how === "finish" ? 2.2 : 1;
          s.pos.lerpVectors(from, to, ease(p));
          y = Math.sin(Math.PI * p) * (2.2 + dist * 0.22) * big;
          spin = ease(p) * Math.PI * 4 * big;
          if (p > 0.05 && p < 0.95 && Math.random() < 0.6) {
            fx.burst({ at: s.pos.clone().setY(s.pos.y + y + 1), count: 2, color: [color, "#ffffff"], speed: [0.1, 0.4], life: [0.4, 0.8], size: [0.12, 0.3] });
          }
        }
        if (p >= 0.98 && !s.landed) {
          s.landed = true;
          s.squash = 1;
          if (m.how === "nebula") {
            fx.burst({ at: to.clone().setY(to.y + 0.5), count: 60, color: ["#b026ff", "#ff2994", "#22d8ff"], speed: [1, 4], life: [0.6, 1.3], size: [0.2, 0.5], gravity: -1 });
          } else if (m.how === "finish") {
            for (let j = 0; j < 5; j++) fx.burst({ at: to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 3, (Math.random() - 0.5) * 4)), count: 70, color: ["#ffd60a", "#ff2994", "#22d8ff", "#8be22a", "#ffffff"], speed: [3, 6], life: [0.8, 1.6], size: [0.2, 0.4], gravity: 3 });
          } else {
            land(to, color, true);
          }
        }
      }
    } else {
      // Settle into place (others arriving shuffle the group).
      if (s.pos.lengthSq() === 0 || t - s.born < 0.05) s.pos.copy(rest);
      s.pos.lerp(rest, 1 - Math.exp(-dt * 8));
      const idleHop = lobby ? Math.abs(Math.sin(t * 3 + index)) * 0.35 : 0;
      y = Math.sin(t * 2.2 + index * 1.3) * 0.04 + idleHop;
      if (restSpot === "nebula" && !lobby) {
        spin = t * 2 + index;
        scale = 0.7;
        y += 0.35 + Math.sin(t * 3 + index) * 0.15;
      }
    }

    root.current.position.set(s.pos.x, s.pos.y + y, s.pos.z);
    pawnWorld.set(info.id, root.current.position);
    s.squash = Math.max(0, s.squash - dt * 4);
    const sq = Math.sin(s.squash * Math.PI) * 0.18;
    body.current.scale.set(scale * (1 + sq), scale * (1 - sq), scale * (1 + sq));
    // Always face the camera (around the vertical axis), plus any spin.
    const look = Math.atan2(camera.position.x - s.pos.x, camera.position.z - s.pos.z);
    face.current.rotation.y = look + spin;

    if (ring.current) {
      ring.current.visible = !!info.current && !lobby;
      ring.current.rotation.z = t * 1.5;
      const pulse = 1 + Math.sin(t * 5) * 0.08;
      ring.current.scale.set(pulse, pulse, pulse);
    }
    if (arrow.current) {
      arrow.current.visible = !!info.current && !lobby && !moving;
      arrow.current.position.y = PAWN_H + 0.9 + Math.abs(Math.sin(t * 3.2)) * 0.4;
      arrow.current.rotation.y = t * 2;
    }
    if (zzz.current) {
      zzz.current.visible = !!info.asleep && !moving;
      zzz.current.position.set(0.7, PAWN_H + 0.3 + ((t * 0.5) % 1) * 0.6, 0);
      zzz.current.material.opacity = 1 - ((t * 0.5) % 1);
    }
    if (skull.current) {
      skull.current.visible = !!info.cursed && !moving;
      skull.current.position.set(Math.cos(t * 1.8) * 0.95, PAWN_H * 0.85, Math.sin(t * 1.8) * 0.95);
    }
    if (tag.current) {
      tag.current.visible = (hover || !!info.current || !!lobby) && !moving;
    }
  });

  if (!mats) return null;
  const tagW = 0.32 * Math.max(3, info.name.length * 0.62);
  return (
    <group ref={root}>
      <group ref={body}>
        <group ref={face} onPointerOver={(e) => (e.stopPropagation(), setHover(true))} onPointerOut={() => setHover(false)}>
          <mesh geometry={geo} material={mats.face} castShadow />
          {[1, 2, 3].map((k) => (
            <mesh key={k} geometry={geo} material={mats.edge} position-z={-k * 0.025} />
          ))}
          <mesh geometry={geo} material={mats.back} position-z={-0.1} />
        </group>
        {/* plastic stand */}
        <mesh position-y={0.08} castShadow receiveShadow>
          <cylinderGeometry args={[0.62, 0.7, 0.16, 32]} />
          <meshStandardMaterial color={color} roughness={0.25} metalness={0.15} />
        </mesh>
        <mesh position-y={0.165}>
          <cylinderGeometry args={[0.48, 0.56, 0.02, 32]} />
          <meshStandardMaterial color={new THREE.Color(color).multiplyScalar(0.7)} roughness={0.3} />
        </mesh>
      </group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.04} visible={false}>
        <ringGeometry args={[0.78, 0.98, 48, 1, 0, Math.PI * 1.7]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      <group ref={arrow} visible={false}>
        <mesh rotation-x={Math.PI}>
          <coneGeometry args={[0.32, 0.6, 4]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
      </group>
      <sprite ref={zzz} scale={0.7} visible={false}>
        <spriteMaterial map={zTex} transparent depthWrite={false} />
      </sprite>
      <sprite ref={skull} scale={0.55} visible={false}>
        <spriteMaterial map={sTex} transparent depthWrite={false} />
      </sprite>
      <sprite ref={tag} position-y={PAWN_H + 0.55} scale={[tagW, 0.32 * 1.0, 1]} visible={false}>
        <spriteMaterial map={nameTex} transparent depthTest={false} />
      </sprite>
    </group>
  );
}

function land(at: THREE.Vector3, color: string, big = false) {
  fx.burst({ at: at.clone().setY(at.y + 0.08), ring: true, count: big ? 26 : 12, color: ["#ffffff", "#e8e2ff", color], speed: [1.2, big ? 3.2 : 2.2], life: [0.3, 0.6], size: [0.15, 0.35], drag: 4, additive: false });
  sfx.hop(big);
}

function lobbySlot(i: number, n: number) {
  // Lined up on START, waiting for the race to begin.
  const p = spotPoint("start");
  const a = (i - (n - 1) / 2) * 0.42;
  return p.add(new THREE.Vector3(Math.sin(a) * 3 + 0.8, 0, -Math.cos(a) * 0.8 + 0.4));
}
