export type Color = "red" | "blue" | "green";

/** Where a pawn is. Spaces are ids from data/board-standard.json. */
export type Pos =
  | { kind: "start" }
  | { kind: "space"; id: string }
  | { kind: "nebula" }
  | { kind: "finish" };

export interface PlayerState {
  id: string;
  name: string;
  pawn: string;
  seat: number;
  pos: Pos;
  /** Bonus card ids in hand (hidden from other players in views). */
  hand: number[];
  /** Action cards this player keeps in front of them (curses and reminders). */
  kept: number[];
  /** Turns still to sit out in the NEBULA. */
  nebulaTurns: number;
  /** Turns to skip outside the Nebula (asleep, refused a dare, ...). */
  skipTurns: number;
  /** Which branch the player took at the fork, used to walk backwards past the merge. */
  branch: "bridge" | "lower";
  /** Free-form per-card flags, e.g. doubleNextRoll, rollBonus. */
  flags: Record<string, number | boolean | string>;
  connected: boolean;
}

export interface Trap {
  space: string;
  card: number;
  owner: string;
}

export interface Option {
  id: string;
  label: string;
}

interface PromptBase {
  id: number;
  /** Short line shown above the prompt, usually the card or space name. */
  title?: string;
  text: string;
}

export type Prompt = PromptBase &
  (
    | { kind: "turn"; player: string; playable: number[] }
    | { kind: "choose"; player: string; options: Option[] }
    | { kind: "roll"; player: string; dice: number }
    | { kind: "spin"; player: string; mode: "action" | "color" }
    | { kind: "pickPlayer"; player: string; candidates: string[] }
    | { kind: "pickSpace"; player: string; candidates: string[] }
    | { kind: "vote"; voters: string[]; options: Option[]; votes: Record<string, string> }
    | { kind: "race"; players: string[]; dice: number[]; wrong: string[] }
    | { kind: "timer"; player: string; seconds: number }
    | { kind: "react"; player: string; cards: number[] }
    | { kind: "text"; player: string; maxLength: number }
  );

export type PromptKind = Prompt["kind"];

export type Answer =
  | { action: "draw" }
  | { action: "play"; card: number }
  | { choice: string }
  | { target: string }
  | { space: string }
  | { answer: number }
  | { card: number | null }
  | { text: string }
  | { done: true }
  | Record<string, never>;

/** One entry in the replay log. Re-running the engine from the seed with these inputs rebuilds the game exactly. */
export type Input =
  | { promptId: number; player: string; answer: Answer }
  | { promptId: number; player: "system"; timeout: true }
  | { interrupt: "gotcha"; player: string; target: string; card: number; reason: string };

export interface LogEntry {
  n: number;
  text: string;
  player?: string;
  card?: { id: number; deck: "A" | "B" };
  dice?: number[];
  spin?: number;
}

export interface Settings {
  videoCall: boolean;
}

export interface Watcher {
  id: number;
  player: string;
  card: number;
  /** Shown next to the pawn so everyone remembers the curse. */
  label: string;
}

export interface GameState {
  phase: "playing" | "over";
  board: string;
  players: PlayerState[];
  turn: number;
  round: number;
  current: string;
  actionDeck: number[];
  actionDiscard: number[];
  bonusDeck: number[];
  bonusDiscard: number[];
  traps: Trap[];
  watchers: Watcher[];
  /** Card being resolved right now, so every screen can show it. */
  active: { card: number; deck: "A" | "B"; player: string } | null;
  lastRoll: { player: string; dice: number[] } | null;
  lastSpin: { player: string; segment: number } | null;
  pending: Prompt | null;
  log: LogEntry[];
  winner: string | null;
  settings: Settings;
}

/** A prompt before the engine gives it an id. */
export type PromptInput = Prompt extends infer P ? (P extends Prompt ? Omit<P, "id"> : never) : never;
