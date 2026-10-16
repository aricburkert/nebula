import type { CardScript } from "./index";

// Action cards 28-54.
export const ACTIONS_2: Record<number, CardScript> = {
  // Go +1. Or go +2. Or go +3.
  34: async (ctx) => {
    const n = await ctx.choose(ctx.me, "Pick one. Yay! A decent card. I think?", [
      ["1", "Go +1"],
      ["2", "Go +2"],
      ["3", "Go +3"],
    ]);
    await ctx.move(ctx.me, Number(n));
  },
};
