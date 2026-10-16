import type { Ctx } from "../game";
import { cannonBlast } from "../spaces";
import { ACTIONS_1 } from "./actions-1";
import { ACTIONS_2 } from "./actions-2";
import { ACTIONS_3 } from "./actions-3";

/** An Action card script. Return "keep" if the player keeps the card in front of them (curses). */
export type CardScript = (ctx: Ctx) => Promise<void | "keep">;

export const CARD_SCRIPTS: Record<number, CardScript> = { ...ACTIONS_1, ...ACTIONS_2, ...ACTIONS_3 };

export interface BonusCard {
  /** "turn": playable from your turn menu. "passive": triggered by the engine (reactions, Freedom!, Dragon Scales!, ...). */
  when: "turn" | "passive";
  canPlay?: (ctx: Ctx) => boolean;
  play: (ctx: Ctx) => Promise<void | "keep">;
  /** For traps: what happens to `victim` when they land on it. `ctx.me` is the trap's owner. */
  onTrap?: (ctx: Ctx, victim: string) => Promise<void>;
}

const passive: BonusCard = { when: "passive", play: async () => {} };

const targetable = (ctx: Ctx) => ctx.others().filter((o) => !ctx.inNebula(o));
const placeableSpaces = (ctx: Ctx) => ctx.allSpaces().filter((s) => !ctx.state.traps.some((t) => t.space === s));

export const BONUS_CARDS: Record<number, BonusCard> = {
  // Steal!
  83: {
    when: "turn",
    canPlay: (ctx) => ctx.others().some((o) => ctx.hand(o).length > 0),
    async play(ctx) {
      const t = await ctx.pickPlayer(ctx.me, "Steal a Bonus card from who?", ctx.others().filter((o) => ctx.hand(o).length > 0));
      if (t) await ctx.harm(t, async (who) => void ctx.takeBonus(who === t ? t : ctx.me, who === t ? ctx.me : t, 1));
    },
  },
  // Spider Monkey Trap!
  84: {
    when: "turn",
    async play(ctx) {
      const s = await ctx.pickSpace(ctx.me, "Point your Spider Monkey Trap at a space.", placeableSpaces(ctx));
      ctx.addTrap(s);
    },
    async onTrap(ctx, victim) {
      await ctx.harm(victim, async (who) => {
        ctx.takeBonus(who, who === victim ? ctx.me : victim, "all");
        ctx.setFlag(ctx.me, "rollBonus", 2);
      }, { text: "A Spider Monkey is swiping all your Bonus cards!" });
    },
  },
  85: passive, // Shield!: handled by Ctx.harm
  // Blow Dart!
  86: {
    when: "turn",
    canPlay: (ctx) => targetable(ctx).length > 0,
    async play(ctx) {
      const t = await ctx.pickPlayer(ctx.me, "Shoot a blow dart at who? They fall asleep for 2 turns.", targetable(ctx));
      if (!t) return;
      let victim = t;
      await ctx.harm(t, async (who) => {
        victim = who;
        ctx.skip(who, 2);
      });
      if (victim === ctx.me || ctx.hand(victim).length === 0) return;
      const tryIt = await ctx.choose(ctx.me, `Try to steal a Bonus card from sleeping ${ctx.name(victim)}? Roll a 2, 4 or 6. Fail and they wake up.`, [
        ["yes", "Try to steal"],
        ["no", "Let them sleep"],
      ]);
      if (tryIt !== "yes") return;
      if (await ctx.rollFor(ctx.me, [2, 4, 6])) ctx.takeBonus(victim, ctx.me, 1);
      else {
        ctx.player(victim).skipTurns = 0;
        ctx.log(`${ctx.name(victim)} woke up!`);
      }
    },
  },
  // Jetpack!
  87: {
    when: "turn",
    canPlay: (ctx) => !ctx.inNebula(ctx.me),
    async play(ctx) {
      await ctx.move(ctx.me, await ctx.rollSum(ctx.me, 3, "Jetpack! Roll 3 dice and fly that far."));
    },
  },
  // Trap Removal!
  88: {
    when: "turn",
    canPlay: (ctx) => ctx.state.traps.length > 0,
    async play(ctx) {
      const s = await ctx.pickSpace(ctx.me, "Remove the trap on which space?", ctx.state.traps.map((t) => t.space));
      ctx.state.traps = ctx.state.traps.filter((t) => t.space !== s);
      ctx.log(`${ctx.name(ctx.me)} removed a trap.`);
    },
  },
  // Double Double!
  89: {
    when: "turn",
    async play(ctx) {
      ctx.setFlag(ctx.me, "doubleNextRoll", true);
      ctx.log(`${ctx.name(ctx.me)}'s next roll or duel is doubled.`);
    },
  },
  // Don't Laugh! (video-call games only)
  90: {
    when: "turn",
    canPlay: (ctx) => ctx.others().length > 0,
    async play(ctx) {
      const t = await ctx.pickPlayer(ctx.me, "Who is not allowed to laugh for 2 turns?");
      if (!t) return;
      const holder = ctx.me;
      ctx.watch(t, `Not allowed to laugh (${ctx.name(holder)} is watching)`, {
        turns: 2,
        gotcha: {
          by: "others",
          apply: () => {
            ctx.nebula(t, 2);
            const c = ctx.game.drawFrom("B");
            if (c !== undefined) ctx.player(holder).hand.push(c);
          },
        },
      });
    },
  },
  // Boat and Canoe!
  91: {
    when: "turn",
    canPlay: (ctx) => ctx.players().some((p) => ctx.spaceType(p) === "boat" || ctx.spaceType(p) === "canoe"),
    async play(ctx) {
      for (const p of ctx.players().filter((p) => ctx.spaceType(p) === "boat" || ctx.spaceType(p) === "canoe")) {
        await ctx.harm(p, (who) => ctx.nebula(who, 2));
      }
    },
  },
  92: passive, // Canceled!: handled by Ctx.harm
  // Spring Trap!
  93: {
    when: "turn",
    async play(ctx) {
      const s = await ctx.pickSpace(ctx.me, "Point your Spring Trap at a space.", placeableSpaces(ctx));
      ctx.addTrap(s);
    },
    async onTrap(ctx, victim) {
      ctx.log(`${ctx.name(victim)} is flung into the air!`);
      if (await ctx.rollFor(ctx.me, [2, 4, 6], `Roll a 2, 4 or 6 to blast ${ctx.name(victim)} into the NEBULA!`)) {
        await ctx.harm(victim, (who) => ctx.nebula(who, 1));
      } else ctx.log(`${ctx.name(victim)} lands safely.`);
    },
  },
  // Warp Speed!
  94: {
    when: "turn",
    canPlay: (ctx) => !ctx.inNebula(ctx.me),
    async play(ctx) {
      const [d] = await ctx.roll(ctx.me, 1, "1: BOAT · 2: CANOE · 3: DRAGON · 4: CANNON · 5-6: NEBULA");
      const target = ({ 1: "boat", 2: "canoe", 3: "dragon-fight", 4: "cannon" } as Record<number, string>)[d];
      if (!target) ctx.nebula(ctx.me, 1);
      else await ctx.moveTo(ctx.me, ctx.spacesOfType(target)[0]);
    },
  },
  95: passive, // Backstab!: handled when anyone collects a Bonus card
  // Hang Glider!
  96: {
    when: "turn",
    canPlay: (ctx) => !ctx.inNebula(ctx.me),
    async play(ctx) {
      const before = new Map(ctx.others().map((o) => [o, ctx.spaceId(o)]));
      const path = await ctx.move(ctx.me, 7);
      const flown = path.slice(0, -1);
      for (const [o, sid] of before) {
        if (sid && flown.includes(sid)) await ctx.harm(o, (who) => ctx.move(who, -2).then(() => undefined));
      }
    },
  },
  // Swap!
  97: {
    when: "turn",
    canPlay: (ctx) => targetable(ctx).length > 0,
    async play(ctx) {
      const t = await ctx.pickPlayer(ctx.me, "Swap places (and all Bonus cards) with who?", targetable(ctx));
      if (!t) return;
      await ctx.harm(t, async () => {
        await ctx.swapPlaces(ctx.me, t);
        const mine = ctx.hand(ctx.me).splice(0);
        const theirs = ctx.hand(t).splice(0);
        ctx.hand(ctx.me).push(...theirs);
        ctx.hand(t).push(...mine);
        ctx.log(`${ctx.name(ctx.me)} and ${ctx.name(t)} swapped Bonus cards too.`);
      });
    },
  },
  // Nebula Trap!
  98: {
    when: "turn",
    async play(ctx) {
      const s = await ctx.pickSpace(ctx.me, "Point your Nebula Trap at a space.", placeableSpaces(ctx));
      ctx.addTrap(s);
    },
    async onTrap(ctx, victim) {
      await ctx.harm(victim, (who) => ctx.nebula(who, 1));
    },
  },
  99: passive, // My Turn! Your Turn!: the holder presses "Gotcha" on a chat message
  100: passive, // Paddle Paddle Paddle!: offered when you fail at the Canoe
  101: passive, // Freedom!: offered at the start of your turn in the Nebula
  102: passive, // Dragon Scales!: offered at a Dragon fight
  // Friendly Swap!
  103: {
    when: "turn",
    canPlay: (ctx) => ctx.closestPlayer() !== null,
    async play(ctx) {
      const t = ctx.closestPlayer();
      if (t) await ctx.harm(t, () => ctx.swapPlaces(ctx.me, t));
    },
  },
  // Safe Isn't Safe!
  104: {
    when: "turn",
    canPlay: (ctx) => ctx.others().some((o) => ctx.isSafe(o)),
    async play(ctx) {
      const t = await ctx.pickPlayer(ctx.me, "Send which player on a Safe Zone into the NEBULA?", ctx.others().filter((o) => ctx.isSafe(o)));
      if (!t) return;
      await ctx.harm(t, (who) => {
        ctx.nebula(who, 1);
        if (who === t) ctx.takeBonus(t, ctx.me, "all");
      });
    },
  },
  // Your Rules!
  105: {
    when: "turn",
    async play(ctx) {
      const rule = await ctx.askText(ctx.me, "Make up a rule for 1 turn. If it's too ridiculous the others can send you back to START.");
      ctx.log(`📜 ${ctx.name(ctx.me)}'s rule: "${rule}"`);
      const verdict = await ctx.majority(ctx.others(), `${ctx.name(ctx.me)}'s rule: "${rule}"`, [
        ["ok", "Fair enough"],
        ["cheat", "Too ridiculous, back to START"],
      ]);
      if (verdict === "cheat") await ctx.toStart(ctx.me);
    },
  },
  // Cannonball!
  106: {
    when: "turn",
    async play(ctx) {
      for (let i = 1; i <= 2; i++) {
        const colors = await ctx.spinColor(ctx.me, `Fire the CANNON (${i} of 2)! Anyone on that color goes back 3. If it hits you, you go +3 instead.`);
        await cannonBlast(ctx, colors, 3, { hitSelfBonus: true });
      }
    },
  },
  // Reverse Reverse!
  107: passive,
  // Star Power!
  108: {
    when: "turn",
    canPlay: (ctx) => !ctx.inNebula(ctx.me),
    async play(ctx) {
      const s = await ctx.pickSpace(ctx.me, "Warp to which star?", ctx.spacesOfType("star"));
      await ctx.moveTo(ctx.me, s);
      const me = ctx.me;
      ctx.watch(me, "Next 3 rolled: gobbled by the NEBULA", {
        onRoll: async (dice) => {
          if (!dice.includes(3)) return false;
          ctx.log(`${ctx.name(me)} rolled a 3. Star Power! ejects them into the NEBULA!`);
          ctx.nebula(me, 1);
          return true;
        },
      });
    },
  },
};
