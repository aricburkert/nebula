import type { CardScript } from "./index";

// Action cards 1-27. Card text is in data/cards.json; each script follows it as closely as the online game allows.
export const ACTIONS_1: Record<number, CardScript> = {
  // A kind wizard picks you up on his broom. Roll 3 DICE to see how far he will take you for a ride.
  1: async (ctx) => {
    await ctx.move(ctx.me, await ctx.rollSum(ctx.me, 3, "The wizard's broom! Roll 3 dice."));
  },
  // Roll 2 DICE. Both even: forward that amount. Both odd: back that amount. Mixed: forward and steal a BONUS CARD from the person on your right.
  2: async (ctx) => {
    const [a, b] = await ctx.roll(ctx.me, 2);
    const sum = a + b;
    if (a % 2 === 0 && b % 2 === 0) await ctx.move(ctx.me, sum);
    else if (a % 2 === 1 && b % 2 === 1) await ctx.harm(ctx.me, (who) => ctx.move(who, -sum).then(() => undefined));
    else {
      await ctx.move(ctx.me, sum);
      const right = ctx.rightOf();
      await ctx.harm(right, (who) => void ctx.takeBonus(who === right ? right : ctx.me, who === right ? ctx.me : right, 1));
    }
  },
  // Move +10. Keep this card: the next time you roll a 3, go to the NEBULA.
  24: async (ctx) => {
    await ctx.move(ctx.me, 10);
    const me = ctx.me;
    ctx.watch(me, "Next 3 rolled: blasted into the NEBULA", {
      onRoll: async (dice) => {
        if (!dice.includes(3)) return false;
        ctx.log(`${ctx.name(me)} rolled a 3 and blasts off to meet the NEBULA face to face!`);
        ctx.nebula(me, 1);
        return true;
      },
    });
    return "keep";
  },
};
