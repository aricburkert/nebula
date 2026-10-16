import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import { BOARD_D, BOARD_W } from "./coords";
import type { Director } from "./director";
import { DECK_AT } from "./Decks";
import { pawnWorld } from "./Pawns";

type Impl = CameraControls;

/**
 * The camera: a wide overview of the board by default, swooping in to follow a pawn while it moves.
 * Dragging, pinching or scrolling takes over for a few seconds; the recenter button gives control back.
 */
export function CameraRig({
  director,
  mode,
  auto,
  overview: forceOverview,
  recenter,
}: {
  director?: Director;
  mode: "attract" | "lobby" | "game";
  auto: boolean;
  overview?: boolean;
  recenter: number;
}) {
  const ref = useRef<Impl>(null);
  const { size, camera } = useThree();
  const userUntil = useRef(0);
  const lastKey = useRef("");
  const introAt = useRef(-1);
  const clock = useRef(0);

  // The overview only depends on the screen shape; it's asked for every idle frame, so work it out once.
  const poseCache = useRef<{ key: string; pose: { pos: THREE.Vector3; target: THREE.Vector3 } } | null>(null);
  const overviewPose = () => {
    const cam = camera as THREE.PerspectiveCamera;
    const key = `${size.width}x${size.height}:${cam.fov}`;
    if (poseCache.current?.key !== key) poseCache.current = { key, pose: computeOverview() };
    const p = poseCache.current.pose;
    return { pos: p.pos.clone(), target: p.target.clone() };
  };
  const computeOverview = () => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    const portrait = aspect < 1;
    const polar = portrait ? 0.62 : 0.78;
    const target = new THREE.Vector3(0, 0, portrait ? 0 : 1.5);
    // Find the closest distance where the whole board fits on screen, leaving room for the prompt bar.
    const probe = new THREE.PerspectiveCamera(cam.fov, aspect, 0.5, 700);
    const corners = [-1, 1].flatMap((x) => [-1, 1].map((z) => new THREE.Vector3((x * BOARD_W) / 2, 0, (z * BOARD_D) / 2)));
    const fits = (d: number) => {
      probe.position.copy(target).add(new THREE.Vector3(0, Math.cos(polar) * d, Math.sin(polar) * d));
      probe.lookAt(target);
      probe.updateMatrixWorld();
      return corners.every((c) => {
        const p = c.clone().project(probe);
        return Math.abs(p.x) < (portrait ? 1.25 : 0.97) && p.y < 0.8 && p.y > (portrait ? -0.6 : -0.72);
      });
    };
    let lo = 20, hi = 160;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    const d = Math.min(hi, portrait ? 75 : 110);
    const pos = target.clone().add(new THREE.Vector3(0, Math.cos(polar) * d, Math.sin(polar) * d));
    return { pos, target };
  };

  useEffect(() => {
    userUntil.current = 0;
    lastKey.current = "";
  }, [recenter, mode]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const o = overviewPose();
    if (mode === "attract") c.setLookAt(o.pos.x * 1.1, o.pos.y * 0.75, o.pos.z * 1.15, 0, 0, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useFrame((state, dt) => {
    const c = ref.current;
    if (!c) return;
    clock.current = state.clock.elapsedTime;
    const now = state.clock.elapsedTime;
    if (mode === "attract" || mode === "lobby") {
      if (now > userUntil.current) c.rotate(dt * 0.035, 0, false);
      if (mode === "lobby" && lastKey.current !== "lobby" && now > userUntil.current) {
        lastKey.current = "lobby";
        const o = overviewPose();
        c.setLookAt(o.pos.x, o.pos.y, o.pos.z, o.target.x, o.target.y, o.target.z, true);
      }
      return;
    }
    if (!director) return;
    const a = director.active;

    if (a?.ev.kind === "intro" && introAt.current !== a.id) {
      introAt.current = a.id;
      const o = overviewPose();
      c.smoothTime = 1.3;
      c.setLookAt(-30, 70, 80, 0, 0, 0, false);
      c.setLookAt(o.pos.x, o.pos.y, o.pos.z, o.target.x, o.target.y, o.target.z, true);
      lastKey.current = "overview";
      return;
    }
    if (a?.ev.kind !== "intro") c.smoothTime = 0.65;
    if (!auto || now < userUntil.current) return;

    let want: { pos: THREE.Vector3; target: THREE.Vector3; key: string; live?: boolean } | null = null;
    const portrait = size.width < size.height;
    const near = (p: THREE.Vector3, dist: number, key: string, live = false) => {
      const target = p.clone().multiplyScalar(0.82).setY(p.y * 0.5 + 0.8);
      const pos = target.clone().add(new THREE.Vector3(0, dist * 0.72, dist * 0.7));
      return { pos, target, key, live };
    };
    if (forceOverview) want = { ...overviewPose(), key: "overview" };
    else if (a?.ev.kind === "move") {
      const p = pawnWorld.get(a.ev.motion.player);
      if (p) want = near(p, portrait ? 30 : 23, `move:${a.id}`, true);
    } else if (a?.ev.kind === "win") {
      const p = pawnWorld.get(a.ev.player);
      if (p) {
        const t = now * 0.4;
        const target = p.clone().setY(1.5);
        want = { target, pos: target.clone().add(new THREE.Vector3(Math.sin(t) * 13, 8, Math.cos(t) * 13 + 4)), key: "win", live: true };
      }
    } else if (a?.ev.kind === "card" && !/played/.test(a.ev.text)) {
      // Glance at the deck so you see the card come off the pile.
      want = near(DECK_AT[a.ev.deck].clone().setX(DECK_AT[a.ev.deck].x - 6), portrait ? 36 : 28, `card:${a.id}`);
    } else if (a?.ev.kind === "turn") {
      const p = pawnWorld.get(a.ev.player);
      if (p) want = near(p, portrait ? 40 : 32, `turn:${a.id}`);
    } else if (director.idleFor() > 1.4) {
      want = { ...overviewPose(), key: "overview" };
    }
    if (want && (want.live || want.key !== lastKey.current)) {
      lastKey.current = want.key;
      c.setLookAt(want.pos.x, want.pos.y, want.pos.z, want.target.x, want.target.y, want.target.z, true);
    }
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={8}
      maxDistance={110}
      minPolarAngle={0.12}
      maxPolarAngle={1.32}
      smoothTime={0.65}
      draggingSmoothTime={0.12}
      onStart={() => {
        userUntil.current = clock.current + (mode === "game" ? 9 : 6);
        lastKey.current = "";
      }}
    />
  );
}
