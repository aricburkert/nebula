// Splits a board SVG into the pieces the 3D board needs:
//   flat.svg        the printed board without the illustrations that stand up off it
//   pieces/<n>.svg  each illustration, cropped, to stand up as a cut-out
//   boardArt*.json  piece boxes (plus, for Standard, outlines for the raised track, water and tokens)
//
//   node scripts/board-art.mjs                                       # Standard, from public/assets/board/standard.svg
//   node scripts/board-art.mjs deep-space "path/to/Deep Space Edition.svg"
//
// The Deep Space SVG (87 MB, mostly one embedded starfield photo) isn't kept in the repo; this also writes the
// compressed starfield into its flat board, the flat 2D picture of the whole board, and the spinner when its SVG is
// given as a third argument. Needs the `playwright` package (PLAYWRIGHT_CHROMIUM points at a Chromium binary).
import fs from "node:fs";
import path from "node:path";

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Top-level element indexes inside each board's main <g>, found by rendering each range.
const BOARDS = {
  standard: {
    src: "public/assets/board/standard.svg",
    out: "public/assets/board3d",
    meta: "src/client/three/boardArt.json",
    count: 1009,
    pieces: {
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
      nebula: range(837, 1008), // the two people, split left/right below
    },
    split: 4560,
    stars: [[78], [255], [257]],
    shields: [
      [246, 247],
      [249, 250],
      [252, 253],
      [274, 275],
    ],
    track: 43,
    river: 16,
    rapids: 1,
  },
  // Same layout as Standard (every space, star and shield is in the same place), redrawn in space.
  "deep-space": {
    src: process.argv[3],
    out: "public/assets/board3d/deep-space",
    meta: "src/client/three/boardArt-deep-space.json",
    count: 963,
    pieces: {
      hook: range(158, 179),
      cannon: range(338, 372), // 337 is the CANNON! label
      "bee-top": [203],
      "bee-bottom": range(206, 260),
      boat: range(382, 397),
      dragon: range(261, 309),
      canoe: range(408, 550),
      recovery: range(653, 780),
      "start-text": [406],
      "finish-text": [112],
      troll: range(561, 652),
      title: [407],
      vortex: range(781, 784),
      nebula: range(785, 962),
    },
    split: 4600,
    // The top Hippo Bee is one group that also holds its space's text; those children stay printed on the board.
    keepFlat: { 203: [0, 56] },
    stars: [
      [113, 114],
      [325, 326],
      [328, 329],
    ],
    shields: [
      [310, 311, 312, 313],
      [316, 317, 318, 319],
      [320, 321, 322, 323],
      [399, 400, 401, 402],
    ],
    // Elements 0-1 are the starfield; it's swapped for a compressed copy.
    background: [0, 1],
    spinner: process.argv[4],
  },
};

const NAME = process.argv[2] ?? "standard";
const B = BOARDS[NAME];
if (!B) throw new Error(`Unknown board "${NAME}". Use one of: ${Object.keys(BOARDS).join(", ")}`);
if (!B.src || !fs.existsSync(B.src)) throw new Error(`Board SVG not found: ${B.src}`);

const svg = fs.readFileSync(B.src, "utf8");
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
if (els.length !== B.count) throw new Error(`Expected ${B.count} board elements, found ${els.length}. Re-check the index ranges.`);
// Figma's background blurs are HTML inside the SVG; drawing them would taint the canvas the texture comes from.
const dropped = new Set(els.flatMap((el, i) => (el.startsWith("<foreignObject") ? [i] : [])));

/** A group split in two: the children listed stay on the flat board, the rest stand up. */
function splitGroup(el, flatKids) {
  const open = el.slice(0, el.indexOf(">") + 1);
  const kids = children(el.slice(open.length, el.lastIndexOf("</g>")));
  const pick = (keep) => `${open}\n${kids.filter((_, i) => flatKids.includes(i) === keep).join("\n")}\n</g>`;
  return { flat: pick(true), piece: pick(false) };
}
const keepFlat = B.keepFlat ?? {};
const pieceXml = (i) => (keepFlat[i] ? splitGroup(els[i], keepFlat[i]).piece : els[i]);
const flatXml = (i) => (keepFlat[i] ? splitGroup(els[i], keepFlat[i]).flat : els[i]);

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
const defsFor = (xml) => {
  const ids = closure(xml);
  return {
    masks: [...ids].filter((id) => maskEls.has(id)).map((id) => maskEls.get(id)).join("\n"),
    defs: [...ids].filter((id) => defEls.has(id)).map((id) => defEls.get(id)).join("\n"),
  };
};

// Real bounding boxes, measured by a browser.
const { chromium } = await import("playwright");
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ["--allow-file-access-from-files"],
});
const page = await browser.newPage();
await page.goto("file://" + path.resolve(B.src), { timeout: 180000 });
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
const PIECES = { ...B.pieces };
{
  const all = PIECES.nebula.filter((i) => !dropped.has(i) && !els[i].startsWith("<mask"));
  delete PIECES.nebula;
  PIECES["nebula-woman"] = all.filter((i) => { const [a, , b] = bbox(i); return (a + b) / 2 < B.split; });
  PIECES["nebula-man"] = all.filter((i) => !PIECES["nebula-woman"].includes(i));
}
for (const k of Object.keys(PIECES)) PIECES[k] = PIECES[k].filter((i) => !dropped.has(i));

const tokens = [...B.stars.flat(), ...B.shields.flat()];
const standing = new Set([...Object.values(PIECES).flat(), ...tokens]);
fs.mkdirSync(path.join(B.out, "pieces"), { recursive: true });

// Flat board: everything that isn't standing up. Masks stay (they're definitions).
let background = "";
if (B.background) {
  // Render just the starfield at a sensible size and embed it as a JPEG instead of the 64 MB PNG.
  const bgXml = B.background.map((i) => els[i]).join("\n");
  const { masks, defs: d } = defsFor(head + bgXml);
  const tmp = path.resolve(B.out, ".bg.svg");
  fs.writeFileSync(tmp, `${head}\n${masks}\n${bgXml}\n</g>\n<defs>\n${d}\n</defs>\n</svg>\n`);
  const W = 4096, H = Math.round((W * 2775) / 5475);
  const p2 = await browser.newPage({ viewport: { width: W, height: H } });
  fs.writeFileSync(tmp + ".html", `<html><body style="margin:0"><img src="${path.basename(tmp)}" style="width:100vw;height:100vh;display:block"></body></html>`);
  await p2.goto("file://" + tmp + ".html");
  await p2.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0, null, { timeout: 180000 });
  const jpg = await p2.screenshot({ type: "jpeg", quality: 80 });
  await p2.close();
  fs.rmSync(tmp);
  fs.rmSync(tmp + ".html");
  background = `<image width="5475" height="2775" preserveAspectRatio="none" xlink:href="data:image/jpeg;base64,${jpg.toString("base64")}"/>`;
}
const flatIdx = els.map((_, i) => i).filter((i) => !dropped.has(i) && !(B.background ?? []).includes(i) && (!standing.has(i) || keepFlat[i] || els[i].startsWith("<mask")));
const flatBody = flatIdx.map(flatXml).join("\n");
{
  const { defs: d } = defsFor(head + flatBody);
  fs.writeFileSync(path.join(B.out, "flat.svg"), `${head}\n${background}\n${flatBody}\n</g>\n<defs>\n${d}\n</defs>\n</svg>\n`);
}

const meta = { width: 5475, height: 2775, pieces: {} };
for (const [name, idx] of Object.entries(PIECES)) {
  const xml = idx.map(pieceXml).join("\n");
  let [x0, y0, x1, y1] = unionBox(idx);
  const pad = 14;
  x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
  const { masks, defs: d } = defsFor(xml);
  const w = x1 - x0, h = y1 - y0;
  fs.writeFileSync(
    path.join(B.out, "pieces", `${name}.svg`),
    `<svg width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n${masks}\n${xml}\n<defs>\n${d}\n</defs>\n</svg>\n`,
  );
  meta.pieces[name] = { box: [x0, y0, w, h] };
}

if (B.track !== undefined) {
  // Track, water and token outlines come from Standard; Deep Space shares the layout.
  const dOf = (el) => el.match(/\sd="([^"]+)"/)?.[1];
  const useTarget = (el) => defEls.get(el.match(/xlink:href="#([^"]+)"/)?.[1] ?? "");
  meta.stars = B.stars.map(([i]) => ({ d: dOf(els[i]), box: bbox(i) }));
  meta.shields = B.shields.map(([s, p]) => ({ d: dOf(els[s]), plus: dOf(els[p]), box: bbox(s) }));
  meta.shapes = { track: dOf(els[B.track]), river: dOf(useTarget(els[B.river])), rapids: dOf(useTarget(els[B.rapids])) };
}
fs.mkdirSync(path.dirname(B.meta), { recursive: true });
fs.writeFileSync(B.meta, JSON.stringify(meta, null, 1) + "\n");

// Deep Space extras: the whole board as one picture for the flat 2D board, and the spinner.
if (NAME !== "standard") {
  const shot = async (src, out, W, H) => {
    const p3 = await browser.newPage({ viewport: { width: W, height: H } });
    const html = path.resolve(path.dirname(out), ".shot.html");
    fs.writeFileSync(html, `<html><body style="margin:0;background:#000"><img src="file://${encodeURI(path.resolve(src))}" style="width:100vw;height:100vh;display:block"></body></html>`);
    await p3.goto("file://" + html);
    await p3.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0, null, { timeout: 180000 });
    await p3.waitForTimeout(300);
    fs.writeFileSync(out, await p3.screenshot({ type: "jpeg", quality: 82 }));
    await p3.close();
    fs.rmSync(html);
  };
  await shot(B.src, `public/assets/board/${NAME}.jpg`, 2400, Math.round((2400 * 2775) / 5475));
  if (B.spinner) await shot(B.spinner, `public/assets/spinner/${NAME}.jpg`, 1400, 1400);
}
await browser.close();

console.log(`flat.svg ${(fs.statSync(path.join(B.out, "flat.svg")).size / 1024).toFixed(0)} KB, ${Object.keys(PIECES).length} pieces`);
for (const [n, p] of Object.entries(meta.pieces)) console.log(n.padEnd(14), p.box.join(" "));
