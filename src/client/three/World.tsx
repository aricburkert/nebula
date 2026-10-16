import { memo, useCallback, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { Board3D } from "./Board3D";
import { CameraRig } from "./CameraRig";
import { Decks } from "./Decks";
import { DiceHud } from "./DiceHud";
import { useDirector, type Director } from "./director";
import { Particles } from "./Particles";
import { Pawns, type PawnInfo } from "./Pawns";
import { Pieces } from "./Pieces";
import type { Quality } from "./quality";
import { Sky } from "./Sky";
import { Spots } from "./Spots";
import { setGpuLimits } from "./textures";
import { THEMES, ThemeContext } from "./theme";
import type { BoardId } from "../../shared/protocol";
import { sfx } from "../sfx";

export interface WorldProps {
  mode: "attract" | "lobby" | "game";
  /** Which edition of the board to draw. */
  board?: BoardId;
  quality: Quality;
  director?: Director;
  pawns: PawnInfo[];
  you?: string | null;
  pickable?: string[];
  onPick?: (space: string) => void;
  traps?: { space: string; title: string }[];
  /** Cards left in the Action and Bonus decks. */
  decks?: { A: number; B: number };
  autoCam: boolean;
  recenter: number;
}

/** The whole 3D scene. One canvas sits behind every screen: home, lobby and game. */
export default function World(props: WorldProps) {
  const { quality } = props;
  return (
    <Canvas
      className="world-canvas"
      shadows={{ type: THREE.PCFShadowMap }}
      // Retina at 2x plus bloom is four times the pixels for little visible gain; 1.5x keeps edges crisp.
      dpr={quality === "high" ? [1, 1.5] : [1, 1.25]}
      flat
      // On high, the effect composer does its own anti-aliasing, so the canvas doesn't need to.
      gl={{ antialias: quality !== "high", powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 38, position: [0, 40, 38], near: 0.5, far: 700 }}
      onCreated={({ gl }) => setGpuLimits(gl)}
    >
      <Scene {...props} />
    </Canvas>
  );
}

// The scene re-renders whenever the game or the animation timeline moves on; most of it doesn't depend on either.
const MSky = memo(Sky);
const MLights = memo(Lights);
const MBoard3D = memo(Board3D);
const MPieces = memo(Pieces);
const MPawns = memo(Pawns);
const MSpots = memo(Spots);
const MDecks = memo(Decks);
const MParticles = memo(Particles);
const NO_TRAPS: { space: string; title: string }[] = [];

function Scene({ mode, board, quality, director, pawns, you, pickable, onPick, traps, decks, autoCam, recenter }: WorldProps) {
  const post = quality === "high";
  const pawnsRef = useRef(pawns);
  pawnsRef.current = pawns;
  const pawnOf = useCallback((id: string) => pawnsRef.current.find((p) => p.id === id)?.pawn ?? "hot-purple", []);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pick = useCallback((space: string) => pickRef.current?.(space), []);
  return (
    <ThemeContext.Provider value={THEMES[board ?? "standard"]}>
      <color attach="background" args={["#05010f"]} />
      <fog attach="fog" args={["#120428", 90, 260]} />
      <MSky quality={quality} />
      <MLights quality={quality} />
      <MBoard3D quality={quality} />
      <MPieces intro={mode === "game" ? 0.6 : 0} flatTitle={mode === "game"} />
      <MPawns players={pawns} director={mode === "game" ? director : undefined} lobby={mode === "lobby"} />
      {mode === "game" && <MSpots pickable={pickable} onPick={pick} traps={traps ?? NO_TRAPS} />}
      <MDecks director={mode === "game" ? director : undefined} a={decks?.A ?? 60} b={decks?.B ?? 30} you={you ?? null} />
      <MParticles />
      <CameraRig director={director} mode={mode} auto={autoCam} overview={!!pickable?.length} recenter={recenter} />
      {director && mode === "game" && <Ticker director={director} you={you ?? null} />}
      {director && mode === "game" && <Hud director={director} pawnOf={pawnOf} priority={post ? 2 : 1} />}
      {post && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.75} luminanceThreshold={0.92} luminanceSmoothing={0.2} radius={0.7} />
          <Vignette eskil={false} offset={0.25} darkness={0.65} />
        </EffectComposer>
      )}
    </ThemeContext.Provider>
  );
}

function Hud({ director, pawnOf, priority }: { director: Director; pawnOf: (id: string) => string; priority: number }) {
  const snap = useDirector(director);
  return <DiceHud director={director} snap={snap} pawnOf={pawnOf} priority={priority} />;
}

function Lights({ quality }: { quality: Quality }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -32;
    cam.right = 32;
    cam.top = 20;
    cam.bottom = -20;
    cam.near = 1;
    cam.far = 90;
    cam.updateProjectionMatrix();
    l.target.position.set(0, 0, 0);
    scene.add(l.target);
  }, [scene]);
  const map = quality === "high" ? 2048 : 1536;
  return (
    <>
      <ambientLight intensity={0.48} color="#f1ecff" />
      <hemisphereLight args={["#e8e4ff", "#3b1d5e", 0.3]} />
      <directionalLight
        ref={sun}
        position={[12, 34, 22]}
        intensity={0.92}
        color="#fff6ea"
        castShadow
        shadow-mapSize-width={map}
        shadow-mapSize-height={map}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[-24, 10, -30]} intensity={0.55} color="#ff5ad9" />
      <directionalLight position={[26, 6, -10]} intensity={0.3} color="#5ad8ff" />
    </>
  );
}

/** Runs the director's clock and plays the little sounds that go with each moment. */
function Ticker({ director, you }: { director: Director; you: string | null }) {
  const last = useRef(-1);
  useFrame((_, dt) => {
    director.tick(Math.min(dt, 0.25));
    const a = director.active;
    if (a && a.id !== last.current) {
      last.current = a.id;
      if (a.ev.kind === "card") sfx.card();
      if (a.ev.kind === "turn") (a.ev.player === you ? sfx.yourTurn : sfx.turn)();
      if (a.ev.kind === "win") sfx.fanfare();
    }
  });
  return null;
}
