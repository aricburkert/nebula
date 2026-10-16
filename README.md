# The Nebula from Hell — online

An online multiplayer version of the party board game *The Nebula from Hell*: create a room, share the link, and race your friends to FINISH. Deploys to Cloudflare.

## Where things are

- `docs/rules.md` — the rules spec the game implements, with open questions.
- `docs/card-review.md` — which cards work online as is, as a chat version, only on a video call, or not at all.
- `data/cards.json` — all 108 cards, transcribed.
- `data/board-standard.json` — the Standard Edition board: 33 spaces, colors, fork, warps.
- `data/spinner-standard.json` — the spinner's 8 segments.
- `src/engine/` — the game itself: rules, board, every card's script, and a bot. It runs on the server and replays from its input log, so a game survives restarts.
- `src/worker/` — the Cloudflare Worker (`/api/rooms`) and the `Room` Durable Object that holds each game, its chat and its players.
- `src/client/` — the React app: home page, lobby, prompts, hand, chat and log. `Board.tsx` is the flat 2D board, used when WebGL isn't available.
- `src/client/three/` — the 3D game (three.js via react-three-fiber): the board with a raised track, the illustrations standing up off it as pop-up cardboard standees, pawns, decks, dice and spinner. `director.ts` turns each new game state into a timeline of animations so everyone sees the same dice, card and hop in order; it never changes the game.
- `public/assets/` — the real card art, board, spinner, pawns and logos. `board3d/` is generated from the board SVG (see below).

## Run it locally

```sh
npm install
npm run dev      # http://localhost:5173 (Worker and Durable Object run locally too)
npm test         # engine tests: every card, plus 60 simulated games
npm run build    # typecheck and production build
```

Open the site in two browser windows (or one normal, one private) to play against yourself.

The 3D board art is cut out of `public/assets/board/standard.svg` by a script that needs a browser (for exact bounding boxes). Rerun it only if the board SVG changes:

```sh
PLAYWRIGHT_CHROMIUM=/path/to/chrome node scripts/board-art.mjs
PLAYWRIGHT_CHROMIUM=/path/to/chrome node scripts/board-art.mjs deep-space "Deep Space Edition.svg" "Deep Space Spinner.svg"
```

It writes the flat board (`public/assets/board3d/flat.svg`), one SVG per standee (`public/assets/board3d/pieces/`), and `src/client/three/boardArt.json` (piece positions plus the track, river, star and shield outlines). The Deep Space run writes the same under `public/assets/board3d/deep-space/` and `boardArt-deep-space.json`, plus `public/assets/board/deep-space.jpg` (the 2D board) and `public/assets/spinner/deep-space.jpg`. Its source SVGs (130 MB, mostly an embedded starfield photo) aren't kept in the repo.

The host picks Standard or Deep Space in the lobby. Both boards have the same spaces and rules; each has its own six pawns (every Deep Space pawn is a twin of a Standard one, so switching boards swaps everyone to their twin).

The settings menu in a game switches 3D quality (High adds bloom and sharper textures), the auto camera, and sound.

## Deploy to Cloudflare

It's a single Worker with static assets and one Durable Object; `wrangler.jsonc` has everything.

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository** and pick `aricburkert/nebula`.
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy`. Root directory: `/`.
3. Save and deploy. Every push to `main` publishes again.

If pushes stop publishing, check **Settings → Build** on the Worker. A banner saying the project is disconnected from your Git account means the Cloudflare GitHub app lost access. Click **Manage**, allow the repo, and refresh.

No secrets or environment variables are needed. The Durable Object migration (`v1`, class `Room`) is applied on the first deploy.
