import type { CardScript } from "./index";

// Action cards 55-82.
export const ACTIONS_3: Record<number, CardScript> = {
  // Roll a 1, 3, 4, or 5 to escape. Fail: NEBULA and return all BONUS CARDS to the bottom of the deck. Escape: +4 and a BONUS CARD.
  60: async (ctx) => {
    if (await ctx.rollFor(ctx.me, [1, 3, 4, 5], "The NEBULA is trying to suck you in! Roll a 1, 3, 4 or 5 to escape.")) {
      await ctx.move(ctx.me, 4);
      await ctx.drawBonus(ctx.me, 1);
    } else {
      await ctx.harm(ctx.me, (who) => {
        ctx.nebula(who, 1);
        ctx.loseBonus(who, "all", "deckBottom");
      });
    }
  },
};
