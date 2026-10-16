import * as THREE from "three";

/** Everything the 3D scene draws comes from the original SVG/PNG art, rasterized in the browser at a size the GPU can take. */

const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${url}`));
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

let maxAnisotropy = 8;
let maxSize = 4096;
export function setGpuLimits(renderer: THREE.WebGLRenderer) {
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  maxSize = renderer.capabilities.maxTextureSize;
}

function finish(tex: THREE.Texture) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const textureCache = new Map<string, Promise<THREE.Texture>>();
function cached(key: string, make: () => Promise<THREE.Texture>) {
  let p = textureCache.get(key);
  if (!p) {
    p = make();
    textureCache.set(key, p);
  }
  return p;
}

/** The flat printed board at the widest size this GPU and quality allow. */
export function boardTexture(url: string, width: number): Promise<THREE.Texture> {
  const w = Math.min(width, maxSize);
  return cached(`board:${url}:${w}`, async () => {
    const img = await loadImage(url);
    const h = Math.round((w * img.naturalHeight) / img.naturalWidth || (w * 2775) / 5475);
    const c = canvas(w, h);
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return finish(tex);
  });
}

export interface CutOut {
  /** The art with a white die-cut border around it. */
  face: THREE.Texture;
  /** The same outline in one flat color, for the cardboard edge behind it. */
  edge: THREE.Texture;
  /** World size of the face including the border, in art pixels. */
  width: number;
  height: number;
  /** Border added on each side, in art pixels. */
  border: number;
}

/**
 * Turns a piece of art into a die-cut cardboard piece: a white border is grown around its silhouette,
 * like the punch-out pieces in a real board game box.
 */
export function cutOut(url: string, artW: number, artH: number, opts: { scale?: number; border?: number; edgeColor?: string; borderColor?: string } = {}): Promise<CutOut> {
  const key = `${url}:${JSON.stringify(opts)}`;
  let hit = cutCache.get(key);
  if (hit) return hit;
  hit = (async () => {
    const img = await loadImage(url);
    const border = opts.border ?? Math.max(6, Math.min(artW, artH) * 0.025);
    const scale = Math.min(opts.scale ?? 1.6, 2048 / (artW + border * 2), 2048 / (artH + border * 2));
    const W = (artW + border * 2) * scale;
    const H = (artH + border * 2) * scale;
    const b = border * scale;

    const sil = canvas(W, H);
    const sctx = sil.getContext("2d")!;
    sctx.drawImage(img, b, b, artW * scale, artH * scale);
    sctx.globalCompositeOperation = "source-in";
    sctx.fillStyle = opts.borderColor ?? "#ffffff";
    sctx.fillRect(0, 0, W, H);

    const face = canvas(W, H);
    const fctx = face.getContext("2d")!;
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      fctx.drawImage(sil, Math.cos(a) * b * 0.92, Math.sin(a) * b * 0.92);
    }
    fctx.drawImage(sil, 0, 0);
    // Close tiny gaps inside the border with one more, smaller ring.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      fctx.drawImage(sil, Math.cos(a) * b * 0.45, Math.sin(a) * b * 0.45);
    }
    fctx.drawImage(img, b, b, artW * scale, artH * scale);

    const edge = canvas(W, H);
    const ectx = edge.getContext("2d")!;
    ectx.drawImage(face, 0, 0);
    ectx.globalCompositeOperation = "source-in";
    ectx.fillStyle = opts.edgeColor ?? "#cfc6b8";
    ectx.fillRect(0, 0, W, H);

    const faceTex = finish(new THREE.CanvasTexture(face));
    const edgeTex = finish(new THREE.CanvasTexture(edge));
    return { face: faceTex, edge: edgeTex, width: artW + border * 2, height: artH + border * 2, border };
  })();
  cutCache.set(key, hit);
  return hit;
}
const cutCache = new Map<string, Promise<CutOut>>();

/** A plain image texture (pawn portraits, the vortex). */
export function imageTexture(url: string, scale = 1): Promise<THREE.Texture> {
  return cached(`img:${url}:${scale}`, async () => {
    const img = await loadImage(url);
    const k = Math.min(scale, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = canvas(img.naturalWidth * k, img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return finish(new THREE.CanvasTexture(c));
  });
}

/** One die face: pips for 1-6, a big number for anything else (doubled or boosted rolls). */
const faceCache = new Map<string, THREE.Texture>();
export function dieFace(value: number, color: string): THREE.Texture {
  const key = `${value}:${color}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(S * 0.35, S * 0.3, S * 0.1, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#e9e4f5");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = color;
  const pip = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x * S, y * S, S * 0.085, 0, Math.PI * 2);
    ctx.fill();
  };
  const L = 0.27, M = 0.5, R = 0.73;
  const layouts: Record<number, [number, number][]> = {
    1: [[M, M]],
    2: [[L, L], [R, R]],
    3: [[L, L], [M, M], [R, R]],
    4: [[L, L], [R, L], [L, R], [R, R]],
    5: [[L, L], [R, L], [M, M], [L, R], [R, R]],
    6: [[L, L], [R, L], [L, M], [R, M], [L, R], [R, R]],
  };
  if (layouts[value]) {
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 6;
    layouts[value].forEach(([x, y]) => pip(x, y));
  } else {
    ctx.font = `bold ${value >= 10 ? 130 : 160}px "Luckiest Guy", "Roboto", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(value), S / 2, S / 2 + 10);
  }
  const tex = finish(new THREE.CanvasTexture(c));
  faceCache.set(key, tex);
  return tex;
}

/** An emoji or short label drawn into a sprite texture. */
const glyphCache = new Map<string, THREE.Texture>();
export function glyph(text: string, opts: { size?: number; color?: string; font?: string } = {}): THREE.Texture {
  const key = `${text}:${JSON.stringify(opts)}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const S = opts.size ?? 128;
  const c = canvas(S * Math.max(1, text.length * 0.6), S);
  const ctx = c.getContext("2d")!;
  ctx.font = opts.font ?? `${S * 0.8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = opts.color ?? "#ffffff";
  ctx.lineWidth = S * 0.08;
  ctx.strokeStyle = "rgba(20,0,40,0.85)";
  if (opts.font) ctx.strokeText(text, c.width / 2, S / 2);
  ctx.fillText(text, c.width / 2, S / 2);
  const tex = finish(new THREE.CanvasTexture(c));
  glyphCache.set(key, tex);
  return tex;
}

/** A soft round dot, for particles and glows. */
let dot: THREE.Texture | null = null;
export function softDot(): THREE.Texture {
  if (dot) return dot;
  const S = 64;
  const c = canvas(S, S);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

/** The back of an Action (green) or Bonus (blue) card, matching the 2D reveal. */
const backCache = new Map<string, THREE.Texture>();
export function cardBack(deck: "A" | "B"): THREE.Texture {
  const hit = backCache.get(deck);
  if (hit) return hit;
  const W = 412, H = 562;
  const c = canvas(W, H);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, W * 0.5, H);
  const stops = deck === "A" ? ["#0a6b3c", "#19c46e", "#8be22a"] : ["#0b3f8f", "#2f7dff", "#22d8ff"];
  stops.forEach((s, i) => g.addColorStop(i / 2, s));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 12;
  for (let x = -H; x < W + H; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + H, H);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 10;
  ctx.strokeRect(22, 22, W - 44, H - 44);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.font = `900 250px "Luckiest Guy", "Arial Black", sans-serif`;
  ctx.fillText(deck, W / 2, H * 0.45 + 10);
  ctx.fillStyle = "#fff";
  ctx.fillText(deck, W / 2, H * 0.45);
  ctx.font = `900 46px "Luckiest Guy", "Arial Black", sans-serif`;
  ctx.fillText(deck === "A" ? "ACTION" : "BONUS", W / 2, H * 0.8);
  const tex = finish(new THREE.CanvasTexture(c));
  backCache.set(deck, tex);
  return tex;
}

/** A card face, not cached: cards come and go, so the caller disposes it. */
export async function cardFace(url: string): Promise<THREE.Texture> {
  const img = await loadImage(url);
  const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = canvas(img.naturalWidth * k, img.naturalHeight * k);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return finish(new THREE.CanvasTexture(c));
}
