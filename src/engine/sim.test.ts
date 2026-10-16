import { describe, expect, it } from "vitest";
import { Game, CARDS } from "./game";
import { botInput } from "./bot";
import { Rng } from "./rng";
import { isCardPause } from "./types";
import { CARD_SCRIPTS } from "./cards";

const PAWNS = ["red", "blue", "green", "yellow", "pink", "white"];

async function playRandomGame(seed: number, n: number, videoCall: boolean, top: number[] = [], cardPause = false) {
  const g = new Game({
    seed,
    cardPause,
    settings: { videoCall },
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, pawn: PAWNS[i] })),
  });
  // Stack chosen cards on top of their decks so specific cards get exercised.
  for (const c of top.reverse()) (c <= 82 ? g.state.actionDeck : g.state.bonusDeck).unshift(c);
  await g.start();
  const rng = new Rng(seed * 7 + 1);
  let steps = 0;
  while (g.state.phase === "playing" && steps < 20000) {
    const input = botInput(g, rng);
    if (!input) break;
    const r = await g.submit(input);
    if (!r.ok) throw new Error(`Bot input rejected: ${r.error} ${JSON.stringify(g.state.pending)}`);
    steps++;
  }
  return { g, steps };
}

describe("every card, forced to the top of the deck", () => {
  const ids = CARDS.map((c) => c.id);
  for (const id of ids) {
    it(`card ${id}`, async () => {
      for (const seed of [11, 22, 33]) {
        const { g } = await playRandomGame(seed * 1000 + id, 2 + (seed % 4), true, id <= 82 ? [id] : [id, id]);
        expect(g.errors).toEqual([]);
      }
    });
  }
});

describe("random games", () => {
  it("every Action card has a script", () => {
    const missing = CARDS.filter((c) => c.deck === "A" && !CARD_SCRIPTS[c.id]).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed} plays to the end without errors`, async () => {
      const { g } = await playRandomGame(seed, 2 + (seed % 5), seed % 2 === 0);
      expect(g.errors).toEqual([]);
      if (g.state.phase === "over") expect(g.state.winner).not.toBeNull();
      // Replaying the same inputs rebuilds the same game.
      const again = await Game.replay(g.config, g.inputs);
      expect(JSON.stringify(again.state)).toEqual(JSON.stringify(g.state));
    });
  }
});

describe("computer players", () => {
  for (let seed = 1; seed <= 10; seed++) {
    it(`seed ${seed}: bots only ever answer for themselves`, async () => {
      const n = 3 + (seed % 4);
      const g = new Game({
        seed,
        settings: { videoCall: seed % 2 === 0 },
        players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, pawn: PAWNS[i] })),
      });
      await g.start();
      const bots = new Set(Array.from({ length: n - 1 }, (_, i) => `p${i + 1}`));
      const rng = new Rng(seed);
      for (let steps = 0; g.state.phase === "playing" && steps < 20000; steps++) {
        const botMove = botInput(g, rng, bots);
        if (botMove) expect(bots.has(botMove.player)).toBe(true);
        const input = botMove ?? botInput(g, rng);
        if (!input) break;
        const r = await g.submit(input);
        if (!r.ok) throw new Error(`Input rejected: ${r.error} ${JSON.stringify(g.state.pending)}`);
      }
      expect(g.errors).toEqual([]);
    });
  }
});

describe("reading the Action card", () => {
  it("waits for the drawer to press Continue before the card plays out", async () => {
    const g = new Game({ seed: 5, cardPause: true, settings: { videoCall: false }, players: [0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, pawn: PAWNS[i] })) });
    await g.start();
    const rng = new Rng(5);
    let pauses = 0;
    for (let steps = 0; g.state.phase === "playing" && steps < 400; steps++) {
      const p = g.state.pending;
      if (p?.kind === "turn") {
        const before = g.state.log.length;
        await g.submit({ promptId: p.id, player: p.player, answer: { action: "draw" } });
        const after = g.state.pending;
        // On the Grappling Hook you roll instead of drawing.
        if (g.state.log.slice(before).some((e) => e.card?.deck === "A")) {
          expect(isCardPause(after)).toBe(true);
          expect(after && "player" in after && after.player).toBe(p.player);
          expect((await g.submit({ promptId: after!.id, player: "p9", answer: { choice: "continue" } })).ok).toBe(false);
          pauses++;
        }
        continue;
      }
      const input = botInput(g, rng);
      if (!input) break;
      expect((await g.submit(input)).ok).toBe(true);
    }
    expect(pauses).toBeGreaterThan(5);
    expect(g.errors).toEqual([]);
    const again = await Game.replay(g.config, g.inputs);
    expect(JSON.stringify(again.state)).toEqual(JSON.stringify(g.state));
  });

  for (let seed = 1; seed <= 10; seed++) {
    it(`seed ${seed} plays to the end with the pause on`, async () => {
      const { g } = await playRandomGame(seed, 2 + (seed % 5), seed % 2 === 0, [], true);
      expect(g.errors).toEqual([]);
    });
  }
});
