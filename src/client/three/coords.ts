import * as THREE from "three";
import type { Pos } from "../../engine/types";
import { STANDARD_LAYOUT } from "../boardLayout";
import { SPACES } from "./palette";

/** Board art is 5475 x 2775 px; the 3D board is 1 unit per 100 px, centered on the origin, lying in the XZ plane. */
export const ART_W = STANDARD_LAYOUT.width;
export const ART_H = STANDARD_LAYOUT.height;
export const PX = 0.01;
export const BOARD_W = ART_W * PX;
export const BOARD_D = ART_H * PX;
/** Height of the raised track above the board surface. */
export const TRACK_H = 0.24;
export const SLAB_H = 1.1;

export const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3((x - ART_W / 2) * PX, h, (y - ART_H / 2) * PX);

export { PAWN_COLORS, pawnColor, SPACES, type SpaceInfo } from "./palette";

export const SPACE_BY_ID = new Map(SPACES.map((s) => [s.id, s]));

// START and FINISH signs stand up in 3D, so pawns wait in front of them instead of on the lettering.
const SPOT_3D: Record<string, [number, number]> = { start: [1170, 2590], finish: [700, 500] };

/** Where a pawn stands for a spot ("start", "finish", "nebula" or a space id). */
export function spotPoint(spot: string): THREE.Vector3 {
  const [x, y] = SPOT_3D[spot] ?? STANDARD_LAYOUT.spots[spot] ?? STANDARD_LAYOUT.spots.start;
  const onTrack = spot !== "start" && spot !== "finish" && spot !== "nebula";
  return toWorld(x, y, onTrack ? TRACK_H : 0.02);
}

export const posSpot = (p: Pos) => (p.kind === "space" ? p.id : p.kind);

/** Space ids walking backwards (for when a path comes from an older engine without one). */
export const PREV = new Map<string, string[]>();
for (const s of SPACES) for (const n of s.next) PREV.set(n, [...(PREV.get(n) ?? []), s.id]);


export const SPACE_LABEL: Record<string, string> = {
  bonus: "Collect a Bonus card",
  safe: "Safe Zone",
  spinner: "Spin the spinner",
  fork: "Fork in the path",
  star: "Warp star",
  "hippo-bee": "Hippo Bee",
  "troll-fight": "Troll Fight!",
  "troll-battle": "Troll Battle!",
  boat: "Boat",
  nebula: "Nebula!",
  "dragon-recovery": "Dragon Battle Recovery Zone",
  canoe: "Canoe",
  "dragon-fight": "Dragon Fight!",
  cannon: "Cannon!",
  "grappling-hook": "Grappling Hook",
};
