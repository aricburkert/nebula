import { createContext, useContext } from "react";
import type { BoardId } from "../../shared/protocol";
import standardArt from "./boardArt.json";
import deepSpaceArt from "./boardArt-deep-space.json";

type Box = [number, number, number, number];

/**
 * What changes between the board editions. The spaces, track, stars and shields sit in the same
 * places on both, so the geometry always comes from boardArt.json; only the art and colors differ.
 */
export interface Theme {
  id: BoardId;
  /** The printed board without the standees. */
  flat: string;
  /** Folder of standee SVGs. */
  pieceDir: string;
  pieces: Record<string, { box: Box }>;
  spinner: string;
  /** Rasterize the spinner at this scale (the Standard one is a big SVG, the Deep Space one a photo). */
  spinnerScale: number;
  slab: string;
  trackSide: string;
  /** Glints on the river and rapids. */
  water: [number, number, number];
  fx: {
    /** What comes out of the cannon, and where on its art the muzzle is. */
    cannon: { colors: string[]; flash: string[]; muzzle: [number, number]; additive: boolean };
    dragon: { colors: string[]; mouth: [number, number] };
    embers: string[];
  };
}

export const THEMES: Record<BoardId, Theme> = {
  standard: {
    id: "standard",
    flat: "/assets/board3d/flat.svg",
    pieceDir: "/assets/board3d/pieces",
    pieces: standardArt.pieces as unknown as Theme["pieces"],
    spinner: "/assets/spinner/standard.svg",
    spinnerScale: 0.45,
    slab: "#1a0f33",
    trackSide: "#f4f1ea",
    water: [0.85, 0.97, 1.0],
    fx: {
      cannon: { colors: ["#ffffff", "#dfe6f0", "#c9d2de"], flash: ["#ffcf3a", "#ff7a1a"], muzzle: [0.78, 0.4], additive: false },
      dragon: { colors: ["#ffe14d", "#ff9a1a", "#ff3b1a"], mouth: [0.1, 0.4] },
      embers: ["#ffd23a", "#ff6a1a"],
    },
  },
  "deep-space": {
    id: "deep-space",
    flat: "/assets/board3d/deep-space/flat.svg",
    pieceDir: "/assets/board3d/deep-space/pieces",
    pieces: deepSpaceArt.pieces as unknown as Theme["pieces"],
    spinner: "/assets/spinner/deep-space.jpg",
    spinnerScale: 0.8,
    slab: "#0c0820",
    trackSide: "#2c2448",
    water: [1.0, 0.78, 0.92],
    fx: {
      // The space cannon fires a green ray instead of smoke.
      cannon: { colors: ["#d4ff6a", "#7dff5a", "#3dff9a"], flash: ["#ffffff", "#b8ff4a"], muzzle: [0.86, 0.3], additive: true },
      dragon: { colors: ["#c9fbff", "#38d6ff", "#9b4bff"], mouth: [0.08, 0.5] },
      embers: ["#b9ff5a", "#3fd14a"],
    },
  },
};

export const ThemeContext = createContext<Theme>(THEMES.standard);
export const useTheme = () => useContext(ThemeContext);
