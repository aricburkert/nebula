import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { sfx } from "../sfx";
import { toWorld } from "./coords";
import type { Director } from "./director";
import { fx } from "./Particles";
import { pawnWorld } from "./Pawns";
import { cardBack, cardFace } from "./textures";
import { useAsset } from "./useAsset";

/** Card size on the table, in world units (the printed cards are 825 x 1125). */
const CARD_W = 2.9;
const CARD_H = (CARD_W * 1125) / 825;
const LAYER = 0.011;
/** The two piles sit in the clear strip down the right edge of the board. */
export const DECK_AT = { A: toWorld(5240, 1040, 0.01), B: toWorld(5240, 1590, 0.01) };
const DECK_TWIST = { A: 0.06, B: -0.05 };

/** Seconds on the director clock: lift off the pile, fly up to the camera, then hand over to the readable overlay. */
const LIFT = 0.3;
const FLY = 0.85;
const LAND = LIFT + FLY;

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A flat rounded card outline with 0..1 UVs, so a whole card image maps onto it. */
function cardPlane() {
  const g = new THREE.ShapeGeometry(roundedRect(CARD_W, CARD_H, 0.16), 6);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);
  return g;
}

function useCardGeometry() {
  return useMemo(() => {
    const face = cardPlane();
    const edge = (depth: number) =>
      new THREE.ExtrudeGeometry(roundedRect(CARD_W, CARD_H, 0.16), { depth, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -depth / 2);
    return { face, edge };
  }, []);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function Decks({ director, a, b, you }: { director?: Director; a: number; b: number; you: string | null }) {
  const counts = useMemo(() => ({ A: a, B: b }), [a, b]);
  return (
    <>
      <Pile deck="A" count={counts.A} />
      <Pile deck="B" count={counts.B} />
      {director && <FlyingCard director={director} you={you} counts={counts} />}
    </>
  );
}

/** A face-down pile whose height follows how many cards are left. */
function Pile({ deck, count }: { deck: "A" | "B"; count: number }) {
  const back = useAsset(async () => {
    await document.fonts?.load('46px "Luckiest Guy"').catch(() => {});
    return cardBack(deck);
  }, `back:${deck}`);
  const { face, edge } = useCardGeometry();
  const [hover, setHover] = useState(false);
  const height = Math.max(LAYER * 2, Math.min(count, 90) * LAYER);
  const block = useMemo(() => edge(height), [edge, height]);
  useEffect(() => () => block.dispose(), [block]);
  const sides = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.85 }), []);
  const top = useMemo(() => new THREE.MeshStandardMaterial({ map: blank(), roughness: 0.55 }), []);
  top.map = back ?? blank();
  // A few loose cards near the top so it reads as a pile, not a brick.
  const loose = useMemo(() => [0.035, -0.05, 0.02].map((r, i) => ({ r, dx: (i - 1) * 0.03, dz: (i % 2 ? -1 : 1) * 0.04 })), []);
  const at = DECK_AT[deck];
  if (count <= 0) return null;
  return (
    <group position={at} rotation-y={DECK_TWIST[deck]}>
      {/* lying flat, card tops pointing away from the camera; local +z is up */}
      <group rotation-x={-Math.PI / 2}>
        <mesh geometry={block} material={sides} position-z={height / 2} castShadow receiveShadow />
        {loose.map((l, i) => (
          <mesh key={i} geometry={face} material={top} position={[l.dx, l.dz, height + 0.001 + i * LAYER * 0.6]} rotation-z={l.r} castShadow={i === loose.length - 1} />
        ))}
      </group>
      {/* hit area for the hover tip */}
      <mesh position-y={height / 2 + 0.1} visible={false} onPointerOver={(e) => (e.stopPropagation(), setHover(true))} onPointerOut={() => setHover(false)}>
        <boxGeometry args={[CARD_W, height + 0.2, CARD_H]} />
      </mesh>
      {hover && (
        <Html position={[0, height + 2, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="space-tip">
            <div className="space-tip-name">{deck === "A" ? "Action deck" : "Bonus deck"}</div>
            <div className="space-tip-text">
              {count} card{count === 1 ? "" : "s"} left
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * The card being drawn: it lifts off its pile, flips over and sweeps up to fill the camera,
 * landing exactly where the 2D reveal shows it so the switch to the crisp overlay is seamless.
 * A Bonus card someone plays comes up out of their hand (yours) or off their pawn (everyone else's).
 */
function FlyingCard({ director, you, counts }: { director: Director; you: string | null; counts: { A: number; B: number } }) {
  const { camera, size } = useThree();
  const { face, edge } = useCardGeometry();
  const rim = useMemo(() => edge(0.03), [edge]);
  const ref = useRef<THREE.Group>(null);
  const [ev, setEv] = useState<{ id: number; card: number; deck: "A" | "B"; from: "deck" | "hand" | "pawn"; player?: string } | null>(null);
  const [faceTex, setFaceTex] = useState<THREE.Texture | null>(null);
  const backA = useAsset(async () => cardBack("A"), "back:A:fly");
  const backB = useAsset(async () => cardBack("B"), "back:B:fly");
  const start = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 });
  const whooshed = useRef(-1);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), q: new THREE.Quaternion(), lift: new THREE.Vector3(), liftQ: new THREE.Quaternion(), end: new THREE.Vector3() }), []);

  useEffect(() => {
    if (!ev) return;
    let live = true;
    // The face texture is cached (and usually prefetched when the game state arrived), so don't dispose it here.
    cardFace(ev.card)
      .then((t) => live && setFaceTex(t))
      .catch(() => {});
    return () => {
      live = false;
      setFaceTex(null);
    };
  }, [ev]);

  // One material per side for every card: swapping the map keeps the same shader instead of compiling a new one.
  const mats = useMemo(
    () => ({
      face: new THREE.MeshBasicMaterial({ map: blank(), depthTest: false, toneMapped: false }),
      back: new THREE.MeshBasicMaterial({ map: blank(), depthTest: false, toneMapped: false }),
      rim: new THREE.MeshBasicMaterial({ color: "#ffffff", depthTest: false }),
    }),
    [],
  );
  const back = ev?.deck === "B" ? backB : backA;
  mats.face.map = faceTex ?? blank();
  mats.face.color.set(faceTex ? "#ffffff" : "#f3efe6");
  mats.back.map = back ?? blank();

  /** Where the card ends up: centered in front of the camera, the size of the 2D reveal card. */
  const endPose = (out: THREE.Vector3, q: THREE.Quaternion) => {
    const cam = camera as THREE.PerspectiveCamera;
    const pxW = Math.min(300, size.width * 0.62);
    const pxH = (pxW * 1125) / 825;
    const view = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const d = CARD_H / (view * (pxH / size.height));
    // The overlay's caption sits under the card, nudging it up a little.
    const up = (27 / size.height) * view * d;
    out.set(0, up, -d).applyQuaternion(cam.quaternion).add(cam.position);
    q.copy(cam.quaternion);
  };

  const fetched = useRef(new Set<number>());
  useFrame(() => {
    // Start fetching faces for cards still waiting in the timeline, so they're ready when their turn comes.
    for (const q of director.queue) {
      if (q.kind !== "card" || fetched.current.has(q.card)) continue;
      if (fetched.current.size > 40) fetched.current.clear();
      fetched.current.add(q.card);
      cardFace(q.card).catch(() => {});
    }
    const a = director.active;
    if (a?.ev.kind === "card" && ev?.id !== a.id) {
      const card = a.ev;
      const played = /played/.test(card.text);
      const from = !played ? "deck" : card.player && card.player === you ? "hand" : card.player && pawnWorld.has(card.player) ? "pawn" : "hand";
      setEv({ id: a.id, card: card.card, deck: card.deck, from, player: card.player });
      const s = start.current;
      const cam = camera as THREE.PerspectiveCamera;
      if (from === "deck") {
        const at = DECK_AT[card.deck];
        s.pos.copy(at).setY(at.y + 0.05 + Math.min(90, counts[card.deck]) * LAYER);
        // Face down on the pile: the back looks up at the sky.
        s.quat.setFromEuler(new THREE.Euler(Math.PI / 2, DECK_TWIST[card.deck], Math.PI, "YXZ"));
        s.scale = 1;
      } else if (from === "pawn") {
        s.pos.copy(pawnWorld.get(card.player!)!).add(new THREE.Vector3(0, 3.2, 0));
        s.quat.copy(cam.quaternion);
        s.scale = 0.3;
      } else {
        // Up from the bottom of the screen, like it came out of your hand.
        endPose(tmp.end, tmp.q);
        const d = tmp.end.distanceTo(cam.position);
        const half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * d;
        s.pos.set(0, -half - CARD_H, -d).applyQuaternion(cam.quaternion).add(cam.position);
        s.quat.copy(cam.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.6));
        s.scale = 1;
      }
    }
    const g = ref.current;
    if (!g) return;
    if (!a || a.ev.kind !== "card" || !ev || ev.id !== a.id) {
      g.visible = false;
      return;
    }
    const t = director.clock - a.start;
    if (t > LAND + 0.12) {
      g.visible = false;
      director.land(a.id);
      return;
    }
    g.visible = true;
    const s = start.current;
    endPose(tmp.end, tmp.q);
    if (ev.from === "deck") {
      tmp.lift.copy(s.pos).add(new THREE.Vector3(0, 1.4, 0));
      tmp.liftQ.copy(s.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.35));
      if (t < LIFT) {
        const k = easeOut(t / LIFT);
        g.position.lerpVectors(s.pos, tmp.lift, k);
        g.quaternion.slerpQuaternions(s.quat, tmp.liftQ, k);
        g.scale.setScalar(1);
        return;
      }
    } else {
      tmp.lift.copy(s.pos);
      tmp.liftQ.copy(s.quat);
    }
    if (whooshed.current !== a.id && t >= LIFT * 0.6) {
      whooshed.current = a.id;
      sfx.whoosh();
      if (ev.from === "deck") fx.burst({ at: s.pos, count: 26, color: ev.deck === "A" ? "#5dff9e" : "#5ad8ff", speed: [1.5, 3], spread: 1, life: [0.4, 0.8], size: [0.12, 0.24], ring: true, additive: true });
    }
    const k = easeInOut(Math.min(1, Math.max(0, (t - (ev.from === "deck" ? LIFT : 0)) / (ev.from === "deck" ? FLY : LAND))));
    // Arc up and over on the way, with an extra twist so the flip reads.
    tmp.v.lerpVectors(tmp.lift, tmp.end, k);
    tmp.v.y += Math.sin(k * Math.PI) * 2.2;
    g.position.copy(tmp.v);
    g.quaternion.slerpQuaternions(tmp.liftQ, tmp.q, k);
    g.rotateZ(Math.sin(k * Math.PI) * 0.35);
    g.scale.setScalar(THREE.MathUtils.lerp(s.scale, 1, ev.from === "pawn" ? easeOut(k) : k));
  });

  return (
    <group ref={ref} visible={false}>
      {/* drawn on top of the board as it flies, so it never clips through a standee */}
      <mesh geometry={face} position-z={0.016} renderOrder={20} material={mats.face} />
      <mesh geometry={face} position-z={-0.016} rotation-y={Math.PI} renderOrder={20} material={mats.back} />
      <mesh geometry={rim} renderOrder={19} material={mats.rim} />
    </group>
  );
}

/** A 1x1 white texture, so materials always have a map and never need recompiling when the real one arrives. */
let white: THREE.Texture | null = null;
function blank() {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
  }
  return white;
}
