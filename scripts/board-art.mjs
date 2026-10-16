// Splits boards/Standard Edition.svg into the pieces the 3D board needs:
//   flat.svg        the printed board without the illustrations that stand up off it
//   pieces/<n>.svg  each illustration, cropped, to stand up as a cut-out
//   src/client/three/boardArt.json  piece boxes plus outlines for the raised track, water and tokens
// Run with `node scripts/board-art.mjs` after changing the board SVG (needs the `playwright` package to measure the art).
import fs from "node:fs";
import path from "node:path";

const SRC = "public/assets/board/standard.svg";
const OUT = "public/assets/board3d";
const META = "src/client/three/boardArt.json";

// Top-level element indexes inside the board's main <g>, found by rendering each range.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const PIECES = {
  hook: range(279, 300),
  cannon: range(301, 339),
  "bee-top": range(340, 387),
  "bee-bottom": range(388, 435).filter((i) => i !== 418),
  boat: range(440, 454), // 436-439 is the puddle it floats in, which stays flat
  dragon: range(455, 548),
  canoe: range(549, 659),
  recovery: range(660, 816),
  "start-text": [817],
  "finish-text": [818],
  troll: range(149, 245),
  title: [278],
  vortex: range(819, 836),
  "nebula-woman": range(837, 1008),
  "nebula-man": [],
};
const STARS = [78, 255, 257];
const SHIELDS = [
  [246, 247],
  [249, 250],
  [252, 253],
  [274, 275],
];
const TRACK = 43;
const svg = fs.readFileSync(SRC, "utf8");
const gOpen = svg.indexOf("<g clip-path=");
const gStart = svg.indexOf(">", gOpen) + 1;
const defsAt = svg.indexOf("<defs>");
const gEnd = svg.lastIndexOf("</g>", defsAt);
const head = svg.slice(0, gStart);
const body = svg.slice(gStart, gEnd);
const defs = svg.slice(defsAt, svg.indexOf("</defs>") + "</defs>".length);

/** Splits a run of sibling elements into their outer XML strings. */
function children(xml) {
  const out = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    let depth = 0;
    let j = lt;
    do {
      const close = xml[j + 1] === "/";
      const gt = xml.indexOf(">", j);
      const selfClose = xml[gt - 1] === "/";
      if (close) depth--;
      else if (!selfClose) depth++;
      j = gt + 1;
      if (depth > 0) j = xml.indexOf("<", j);
    } while (depth > 0);
    out.push(xml.slice(lt, j));
    i = j;
  }
  return out;
}

const els = children(body);
if (els.length !== 1009) throw new Error(`Expected 1009 board elements, found ${els.length}. Re-check the index ranges.`);

// Defs elements by id, so each piece only carries the gradients/filters/paths it uses.
const defEls = new Map();
for (const el of children(defs.slice("<defs>".length, -"</defs>".length))) {
  const id = el.match(/\bid="([^"]+)"/)?.[1];
  if (id) defEls.set(id, el);
}
const maskEls = new Map();
els.forEach((el) => {
  if (el.startsWith("<mask")) maskEls.set(el.match(/\bid="([^"]+)"/)[1], el);
});
const refs = (xml) => [...xml.matchAll(/(?:url\(#|xlink:href="#|href="#)([^)"]+)/g)].map((m) => m[1]);
function closure(xml) {
  const seen = new Set();
  const stack = refs(xml);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const el = defEls.get(id) ?? maskEls.get(id);
    if (el) stack.push(...refs(el));
  }
  return seen;
}

// Real bounding boxes, measured by a browser (pass PLAYWRIGHT_CHROMIUM to point at a Chromium binary).
const { chromium } = await import("playwright");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage();
await page.goto("file://" + path.resolve(SRC));
const boxes = await page.evaluate(() =>
  [...document.querySelector("svg > g").children].map((el) => {
    if (el.tagName === "mask") return null;
    try {
      // Screen box (includes the element's own transform); the page shows the SVG at 1 unit = 1 px.
      const r = el.getBoundingClientRect();
      const o = document.querySelector("svg").getBoundingClientRect();
      return r.width * r.height > 0 ? [r.left - o.left, r.top - o.top, r.right - o.left, r.bottom - o.top] : null;
    } catch {
      return null;
    }
  }),
);
await browser.close();
function unionBox(idx) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of idx) {
    const b = boxes[i];
    if (!b) continue;
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
  }
  return [x0, y0, x1, y1];
}
const bbox = (i) => boxes[i] ?? [0, 0, 0, 0];

// The two people in the Nebula are one run of elements; split them left/right.
{
  const all = PIECES["nebula-woman"];
  PIECES["nebula-woman"] = all.filter((i) => { const [a, , b] = bbox(i); return (a + b) / 2 < 4560; });
  PIECES["nebula-man"] = all.filter((i) => !PIECES["nebula-woman"].includes(i));
}

const taken = new Set([...Object.values(PIECES).flat(), ...STARS, ...SHIELDS.flat()]);
fs.mkdirSync(path.join(OUT, "pieces"), { recursive: true });

// Flat board: everything that isn't standing up. Masks stay (they're definitions).
const flatBody = els.filter((el, i) => !taken.has(i) || el.startsWith("<mask")).join("\n");
fs.writeFileSync(path.join(OUT, "flat.svg"), `${head}\n${flatBody}\n</g>\n${defs}\n</svg>\n`);

const meta = { width: 5475, height: 2775, pieces: {}, stars: [], shields: [], shapes: {} };
for (const [name, idx] of Object.entries(PIECES)) {
  const xml = idx.map((i) => els[i]).join("\n");
  let [x0, y0, x1, y1] = unionBox(idx);
  const pad = 14;
  x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
  const ids = closure(xml);
  const masks = [...ids].filter((id) => maskEls.has(id)).map((id) => maskEls.get(id)).join("\n");
  const d = [...ids].filter((id) => defEls.has(id)).map((id) => defEls.get(id)).join("\n");
  const w = x1 - x0, h = y1 - y0;
  fs.writeFileSync(
    path.join(OUT, "pieces", `${name}.svg`),
    `<svg width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n${masks}\n${xml}\n<defs>\n${d}\n</defs>\n</svg>\n`,
  );
  meta.pieces[name] = { box: [x0, y0, w, h] };
}

const dOf = (el) => el.match(/\sd="([^"]+)"/)?.[1];
const useTarget = (el) => defEls.get(el.match(/xlink:href="#([^"]+)"/)?.[1] ?? "");
meta.shapes.track = dOf(els[TRACK]);
meta.shapes.river = dOf(useTarget(els[16]));
meta.shapes.rapids = dOf(useTarget(els[1]));
meta.stars = STARS.map((i) => ({ d: dOf(els[i]), box: bbox(i) }));
meta.shields = SHIELDS.map(([s, p]) => ({ d: dOf(els[s]), plus: dOf(els[p]), box: bbox(s) }));
fs.mkdirSync(path.dirname(META), { recursive: true });
fs.writeFileSync(META, JSON.stringify(meta, null, 1) + "\n");
console.log(`flat.svg ${(fs.statSync(path.join(OUT, "flat.svg")).size / 1024).toFixed(0)} KB, ${Object.keys(PIECES).length} pieces`);
for (const [n, p] of Object.entries(meta.pieces)) console.log(n.padEnd(14), p.box.join(" "));
