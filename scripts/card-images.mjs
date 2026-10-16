// Renders every card SVG to a small WebP for the 3D scene and the card reveal, which decode it off the
// main thread instead of rasterizing a big SVG the moment a card is drawn.
// Usage: node scripts/card-images.mjs   (writes public/assets/cards/webp/<id>.webp)
import { chromium } from "playwright";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = resolve("public/assets/cards");
const OUT = join(SRC, "webp");
const WIDTH = 640;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}), args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
// An HTML page on file:// so it can draw the local SVGs into a canvas.
const blank = join(tmpdir(), "nebula-cards.html");
writeFileSync(blank, "<!doctype html><title>cards</title>");
await page.goto(pathToFileURL(blank).href);
const ids = readdirSync(SRC).filter((f) => /^\d+\.svg$/.test(f)).map((f) => parseInt(f));
for (const id of ids.sort((a, b) => a - b)) {
  const url = pathToFileURL(join(SRC, `${id}.svg`)).href;
  const b64 = await page.evaluate(
    async ({ url, width }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const height = Math.round((width * img.naturalHeight) / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return c.toDataURL("image/webp", 0.86).split(",")[1];
    },
    { url, width: WIDTH },
  );
  writeFileSync(join(OUT, `${id}.webp`), Buffer.from(b64, "base64"));
}
await browser.close();
console.log(`wrote ${ids.length} cards to ${OUT}`);
