import type { Answer } from "../engine/types";
import type { GameView } from "../engine/game";

export const PAWNS = [
  { id: "red", name: "Red" },
  { id: "blazing-orange", name: "Blazing Orange" },
  { id: "yellow", name: "Yellow" },
  { id: "scorchin-green", name: "Scorchin' Green" },
  { id: "green", name: "Green" },
  { id: "neon-blue", name: "Neon Blue" },
  { id: "blue", name: "Blue" },
  { id: "hot-purple", name: "Hot Purple" },
  { id: "pink", name: "Pink" },
  { id: "blazing-pink", name: "Blazing Pink" },
  { id: "white", name: "White" },
  { id: "sleek-silver", name: "Sleek Silver" },
] as const;

export const MAX_PLAYERS = 6;

export interface LobbyPlayer {
  id: string;
  name: string;
  pawn: string;
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  host: string | null;
  phase: "lobby" | "playing" | "over";
  players: LobbyPlayer[];
  settings: { videoCall: boolean };
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
  | { t: "settings"; videoCall: boolean }
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
