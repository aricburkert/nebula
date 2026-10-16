import boardData from "../../../data/board-standard.json";

// Board data and colors the 2D screens share with the 3D scene, kept free of three.js so the menus load fast.

export type SpaceInfo = { id: string; type: string; color: string | null; next: string[]; text?: string; path?: string };
export const SPACES = (boardData as { spaces: SpaceInfo[] }).spaces;

export const PAWN_COLORS: Record<string, string> = {
  red: "#ff3b4a",
  "blazing-orange": "#ff8a1f",
  yellow: "#ffd60a",
  "scorchin-green": "#8be22a",
  green: "#19c46e",
  "neon-blue": "#22d8ff",
  blue: "#2f7dff",
  "hot-purple": "#b026ff",
  pink: "#ff8fc0",
  "blazing-pink": "#ff2994",
  white: "#f2f2f2",
  "sleek-silver": "#b9c2cf",
};
export const pawnColor = (pawn: string) => PAWN_COLORS[pawn] ?? "#b026ff";
