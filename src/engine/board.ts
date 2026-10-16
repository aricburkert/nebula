import standard from "../../data/board-standard.json";
import type { Color, Pos } from "./types";

export interface Space {
  id: string;
  type: string;
  color: Color | null;
  next: string[];
  path?: "bridge" | "lower";
  text?: string;
}

export interface Board {
  name: string;
  spaces: Space[];
  byId: Map<string, Space>;
  /** Space ids that lead into each space. */
  prev: Map<string, string[]>;
  first: string;
  last: string;
}

function build(name: string, spaces: Space[]): Board {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const prev = new Map<string, string[]>();
  for (const s of spaces) for (const n of s.next) if (n !== "finish") prev.set(n, [...(prev.get(n) ?? []), s.id]);
  const last = spaces.find((s) => s.next.includes("finish"))!.id;
  return { name, spaces, byId, prev, first: spaces[0].id, last };
}

export const BOARDS: Record<string, Board> = {
  standard: build("standard", standard.spaces as Space[]),
};

export function space(board: Board, id: string): Space {
  const s = board.byId.get(id);
  if (!s) throw new Error(`Unknown space ${id}`);
  return s;
}

export function colorAt(board: Board, pos: Pos): Color | null {
  return pos.kind === "space" ? space(board, pos.id).color : null;
}

export function typeAt(board: Board, pos: Pos): string | null {
  return pos.kind === "space" ? space(board, pos.id).type : null;
}

/**
 * One step backwards from a space. At the merge (two ways in) we go back the
 * way the player came, which `branch` remembers.
 */
export function stepBack(board: Board, id: string, branch: "bridge" | "lower"): string | "start" {
  const ins = board.prev.get(id) ?? [];
  if (ins.length === 0) return "start";
  if (ins.length === 1) return ins[0];
  return ins.find((p) => space(board, p).path === branch) ?? ins[0];
}

/**
 * Spaces ordered for "distance along the track" comparisons. Both branches get
 * the same progress numbers relative to the fork so players on different
 * branches can still be compared.
 */
export function progress(board: Board, pos: Pos): number {
  if (pos.kind === "start") return 0;
  if (pos.kind === "finish") return 1000;
  if (pos.kind === "nebula") return progress(board, { kind: "space", id: nebulaExit(board) });
  let n = 0;
  let id: string | "start" = pos.id;
  const sp = space(board, pos.id);
  const branch = sp.path ?? "bridge";
  while (id !== "start") {
    n++;
    id = stepBack(board, id, branch);
  }
  return n;
}

/** The space a player comes back to when they leave the NEBULA. */
export function nebulaExit(board: Board): string {
  return board.spaces.find((s) => s.type === "nebula")!.id;
}

export function spacesOfType(board: Board, type: string): string[] {
  return board.spaces.filter((s) => s.type === type).map((s) => s.id);
}
