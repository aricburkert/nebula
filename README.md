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
- `src/client/` — the React app: home page, lobby, board, prompts, hand, chat and log.
- `public/assets/` — the real card art, board, spinner and pawns.

## Run it locally

```sh
npm install
npm run dev      # http://localhost:5173 (Worker and Durable Object run locally too)
npm test         # engine tests: every card, plus 60 simulated games
npm run build    # typecheck and production build
```

Open the site in two browser windows (or one normal, one private) to play against yourself.

## Deploy to Cloudflare

It's a single Worker with static assets and one Durable Object; `wrangler.jsonc` has everything.

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository** and pick `aricburkert/nebula`.
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy`. Root directory: `/`.
3. Save and deploy. Every push to `main` publishes again.

No secrets or environment variables are needed. The Durable Object migration (`v1`, class `Room`) is applied on the first deploy.
