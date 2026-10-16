export type Quality = "high" | "low";

const KEY = "nebula:quality";

/** Phones and small screens start on low (no bloom, smaller textures); anyone can switch in the menu. */
export function initialQuality(): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "high" || saved === "low") return saved;
  } catch {
    // storage blocked
  }
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  return coarse || Math.min(screen.width, screen.height) < 600 ? "low" : "high";
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // storage blocked
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
