import { useSyncExternalStore } from "react";
import { initialQuality, saveQuality, webglAvailable, type Quality } from "./three/quality";
import { sfx } from "./sfx";

/** Per-device display settings from the menu: graphics, camera, sound. Nothing here reaches the server. */
export interface Settings {
  quality: Quality;
  autoCam: boolean;
  muted: boolean;
  /** Bumped by the recenter button. */
  recenter: number;
  /** WebGL works on this device. */
  gl: boolean;
}

let state: Settings = {
  quality: initialQuality(),
  autoCam: true,
  muted: sfx.muted,
  recenter: 0,
  gl: typeof document !== "undefined" && webglAvailable(),
};
const listeners = new Set<() => void>();

export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  if (patch.quality) saveQuality(patch.quality);
  if (patch.muted !== undefined) sfx.setMuted(patch.muted);
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
