import { describe, expect, it } from "vitest";
import { Game, CARDS } from "./game";
import { botInput } from "./bot";
import { Rng } from "./rng";
import { CARD_SCRIPTS } from "./cards";

const PAWNS = ["red", "blue", "green", "yellow", "pink", "white"];

async function playRandomGame(seed: number, n: number, videoCall: boolean) {
  const g = new Game({
    seed,
    settings: { videoCall },
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, pawn: PAWNS[i] })),
  });
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
