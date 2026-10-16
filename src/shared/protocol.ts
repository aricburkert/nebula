import type { Answer } from "../engine/types";
import type { GameView } from "../engine/game";

/** The two editions of the board. Same spaces and rules; Deep Space is the whole game redrawn in outer space. */
export const BOARDS = [
  { id: "standard", name: "Standard" },
  { id: "deep-space", name: "Deep Space" },
] as const;
export type BoardId = (typeof BOARDS)[number]["id"];

/** Each edition has six pawns; every Deep Space pawn is a dressed-up twin of a Standard one. */
export const PAWNS = [
  { id: "red", name: "Red", board: "standard", twin: "blazing-pink" },
  { id: "yellow", name: "Yellow", board: "standard", twin: "blazing-orange" },
  { id: "green", name: "Green", board: "standard", twin: "scorchin-green" },
  { id: "blue", name: "Blue", board: "standard", twin: "neon-blue" },
  { id: "pink", name: "Pink", board: "standard", twin: "hot-purple" },
  { id: "white", name: "White", board: "standard", twin: "sleek-silver" },
  { id: "blazing-pink", name: "Blazing Pink", board: "deep-space", twin: "red" },
  { id: "blazing-orange", name: "Blazing Orange", board: "deep-space", twin: "yellow" },
  { id: "scorchin-green", name: "Scorchin' Green", board: "deep-space", twin: "green" },
  { id: "neon-blue", name: "Neon Blue", board: "deep-space", twin: "blue" },
  { id: "hot-purple", name: "Hot Purple", board: "deep-space", twin: "pink" },
  { id: "sleek-silver", name: "Sleek Silver", board: "deep-space", twin: "white" },
] as const satisfies readonly { id: string; name: string; board: BoardId; twin: string }[];

export const pawnsFor = (board: BoardId) => PAWNS.filter((p) => p.board === board);
export const isBoard = (b: unknown): b is BoardId => BOARDS.some((x) => x.id === b);
/** The pawn to use on a board: itself if it belongs there, otherwise its twin from that edition. */
export function pawnOnBoard(pawn: string, board: BoardId): string {
  const p = PAWNS.find((x) => x.id === pawn);
  if (!p) return pawn;
  return p.board === board ? p.id : p.twin;
}

export const MAX_PLAYERS = 6;

export interface LobbyPlayer {
  id: string;
  name: string;
  pawn: string;
  connected: boolean;
  /** A computer player the host added. */
  bot?: boolean;
}

export interface RoomInfo {
  code: string;
  host: string | null;
  phase: "lobby" | "playing" | "over";
  players: LobbyPlayer[];
  settings: { videoCall: boolean; board: BoardId };
}

export interface ChatMessage {
  id: number;
  player: string | null;
  name: string;
  text: string;
  at: number;
}

export type ClientMsg =
  | { t: "hello"; token?: string }
  | { t: "join"; name: string; pawn: string }
  | { t: "pawn"; pawn: string }
  | { t: "settings"; videoCall?: boolean; board?: BoardId }
  | { t: "addBot" }
  | { t: "removeBot"; player: string }
  | { t: "start" }
  | { t: "answer"; promptId: number; answer: Answer }
  | { t: "gotcha"; target: string; card: number; reason: string }
  | { t: "chat"; text: string }
  | { t: "nudge" }
  | { t: "rematch" };

export type ServerMsg =
  | { t: "welcome"; you: string | null; token?: string }
  | { t: "room"; room: RoomInfo }
  | { t: "state"; game: GameView | null }
  | { t: "chat"; messages: ChatMessage[] }
  | { t: "error"; error: string };
