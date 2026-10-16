import type { Game } from "./game";
import type { Answer, Input, Prompt } from "./types";
import { Rng } from "./rng";

/** Picks a random legal answer for whoever the pending prompt is waiting on. Used by the simulator and for absent players. */
export function botInput(game: Game, rng: Rng): Input | null {
  const p = game.state.pending;
  if (!p) return null;
  const pick = <T,>(xs: T[]) => xs[rng.int(xs.length)];
  const one = (player: string, answer: Answer): Input => ({ promptId: p.id, player, answer });
  switch (p.kind) {
    case "turn":
      return p.playable.length && rng.next() < 0.3 ? one(p.player, { action: "play", card: pick(p.playable) }) : one(p.player, { action: "draw" });
    case "choose":
      return one(p.player, { choice: pick(p.options).id });
    case "roll":
    case "spin":
      return one(p.player, {});
    case "pickPlayer":
      return one(p.player, { target: pick(p.candidates) });
    case "pickSpace":
      return one(p.player, { space: pick(p.candidates) });
    case "vote": {
      const v = p.voters.find((x) => p.votes[x] === undefined)!;
      return one(v, { choice: pick(p.options).id });
    }
    case "race": {
      const left = p.players.filter((x) => !p.wrong.includes(x));
      const sum = p.dice.reduce((a, b) => a + b, 0);
      return one(pick(left), { answer: rng.next() < 0.6 ? sum : sum + 1 });
    }
    case "timer":
      return { promptId: p.id, player: "system", timeout: true };
    case "react":
      return one(p.player, { card: rng.next() < 0.5 ? pick(p.cards) : null });
    case "text":
      return one(p.player, { text: "Everyone must speak like a pirate" });
  }
}

export function promptPlayers(p: Prompt): string[] {
  switch (p.kind) {
    case "vote":
      return p.voters.filter((v) => p.votes[v] === undefined);
    case "race":
      return p.players.filter((x) => !p.wrong.includes(x));
    default:
      return [p.player];
  }
}
