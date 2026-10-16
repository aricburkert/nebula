import type { CardScript } from "./index";
import type { Ctx } from "../game";
import { progress } from "../board";
import type { Color } from "../types";
import { doSegment } from "../spaces";

/** Everyone standing on one of `colors` goes back `n`. A card effect, so Shield/Canceled/Reverse apply. */
async function blast(ctx: Ctx, colors: Color[], n: number) {
  const hit = ctx.players().filter((p) => {
    const c = ctx.color(p);
    return c !== null && colors.includes(c);
  });
  if (hit.length === 0) {
    ctx.log("The cannonball hit nobody.");
    return;
  }
  for (const p of hit) await ctx.harm(p, async (who) => void (await ctx.move(who, -n)));
}

/** Adds to the number the player's next roll gets (stacks with a bonus already waiting). */
function addRollBonus(ctx: Ctx, pid: string, n: number) {
  const cur = ctx.player(pid).flags.rollBonus;
  ctx.setFlag(pid, "rollBonus", (typeof cur === "number" ? cur : 0) + n);
  ctx.log(`${ctx.name(pid)} adds +${n} to their next roll.`);
}

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
    else if (a % 2 === 1 && b % 2 === 1) await ctx.harm(ctx.me, async (who) => void (await ctx.move(who, -sum)));
    else {
      await ctx.move(ctx.me, sum);
      const right = ctx.rightOf();
      await ctx.harm(right, (who) => void ctx.takeBonus(who === right ? right : ctx.me, who === right ? ctx.me : right, 1));
    }
  },

  // Move to the DRAGON space and fight the DRAGON. (The engine resolves the Dragon fight when the turn ends.)
  3: async (ctx) => {
    await ctx.moveTo(ctx.me, ctx.spacesOfType("dragon-fight")[0]);
  },

  // Save a friend from a bully and collect 2 BONUS CARDS, or walk by quietly and go +9.
  4: async (ctx) => {
    const c = await ctx.choose(ctx.me, "A big ol' bully is beating up your friend. What do you do?", [
      ["save", "Save your friend (collect 2 Bonus cards)"],
      ["walk", "Quietly walk by (move +9)"],
    ]);
    if (c === "save") await ctx.drawBonus(ctx.me, 2);
    else await ctx.move(ctx.me, 9);
  },

  // Spin the SPINNER (color). Everyone on that color is blown back 3.
  5: async (ctx) => {
    const colors = await ctx.spinColor(ctx.me, "Spin the spinner! Everyone on the color it lands on is blown back 3.");
    await blast(ctx, colors, 3);
  },

  // Bacon or sausage? Bacon: 1 BONUS CARD and +3. Sausage: lose 1 BONUS CARD, back 1, repent.
  6: async (ctx) => {
    const c = await ctx.choose(ctx.me, "What do you like better? Bacon or sausage?", [
      ["bacon", "Bacon"],
      ["sausage", "Sausage"],
    ]);
    if (c === "bacon") {
      await ctx.drawBonus(ctx.me, 1);
      await ctx.move(ctx.me, 3);
    } else {
      ctx.log(`${ctx.name(ctx.me)} chose sausage. Time to repent of their sins.`);
      await ctx.harm(ctx.me, async (who) => {
        ctx.loseBonus(who, 1);
        await ctx.move(who, -1);
      });
    }
  },

  // 1 die: go that amount. 2 dice: go farther but a 1 means the NEBULA for 1 turn.
  // 4 dice: go farthest but a 1 means the NEBULA for 3 turns and all your BONUS CARDS go to the player on your right.
  7: async (ctx) => {
    const c = await ctx.choose(ctx.me, "How lucky are you feeling?", [
      ["1", "Roll 1 die (safe)"],
      ["2", "Roll 2 dice (a 1 sends you to the NEBULA for 1 turn)"],
      ["4", "Roll 4 dice (a 1 sends you to the NEBULA for 3 turns and you give away all your Bonus cards)"],
    ]);
    const n = Number(c);
    const dice = await ctx.roll(ctx.me, n, `Roll ${n} ${n === 1 ? "die" : "dice"} and go that far.`);
    const sum = dice.reduce((x, y) => x + y, 0);
    const hasOne = dice.includes(1);
    if (n === 1 || !hasOne) {
      await ctx.move(ctx.me, sum);
    } else if (n === 2) {
      await ctx.harm(ctx.me, (who) => ctx.nebula(who, 1));
    } else {
      const right = ctx.rightOf();
      await ctx.harm(ctx.me, (who) => {
        ctx.nebula(who, 3);
        if (right !== who) ctx.takeBonus(who, right, "all");
      });
    }
  },

  // Eat the goblin's eye: +5 now and +5 on your next roll. Or give it back and collect 3 BONUS CARDS.
  8: async (ctx) => {
    const c = await ctx.choose(ctx.me, "You ripped out a goblin's eye. What now?", [
      ["eat", "Eat it (move +5 and add +5 to your next roll)"],
      ["return", "Give it back (collect 3 Bonus cards)"],
    ]);
    if (c === "eat") {
      addRollBonus(ctx, ctx.me, 5);
      await ctx.move(ctx.me, 5);
    } else await ctx.drawBonus(ctx.me, 3);
  },

  // Everyone moves +3 right now.
  9: async (ctx) => {
    for (const p of ctx.players()) await ctx.move(p, 3);
  },

  // Move +7, or save this card to add +3 to your next roll or duel, or collect 1 BONUS CARD.
  10: async (ctx) => {
    const c = await ctx.choose(ctx.me, "Pick one.", [
      ["move", "Move +7"],
      ["save", "Add +3 to your next roll or duel"],
      ["bonus", "Collect 1 Bonus card"],
    ]);
    if (c === "move") await ctx.move(ctx.me, 7);
    else if (c === "save") addRollBonus(ctx, ctx.me, 3);
    else await ctx.drawBonus(ctx.me, 1);
  },

  // Move someone from START to your spot and collect a BONUS CARD. Nobody on START: just +3.
  11: async (ctx) => {
    const atStart = ctx.others().filter((o) => ctx.player(o).pos.kind === "start");
    if (atStart.length === 0) {
      ctx.log("Nobody is on START, so it's just +3.");
      await ctx.move(ctx.me, 3);
      return;
    }
    const t = await ctx.pickPlayer(ctx.me, "Move who from START to your spot?", atStart);
    const mine = ctx.spaceId(ctx.me);
    if (t && mine) await ctx.moveTo(t, mine);
    await ctx.drawBonus(ctx.me, 1);
  },

  // Skip across the meadow and move +4, or jump back 3 spaces into the bushes.
  12: async (ctx) => {
    const c = await ctx.choose(ctx.me, "Skip across the meadow, or jump into the bushes?", [
      ["skip", "Skip across the meadow (+4)"],
      ["bush", "Jump into the bushes (back 3)"],
    ]);
    if (c === "skip") await ctx.move(ctx.me, 4);
    else await ctx.harm(ctx.me, async (who) => void (await ctx.move(who, -3)));
  },

  // Pluck a golden flower: 2 BONUS CARDS and +3. Or mow the whole field: +8 and no BONUS CARDS.
  13: async (ctx) => {
    const c = await ctx.choose(ctx.me, "A field of golden magic flowers!", [
      ["pluck", "Pluck one flower (2 Bonus cards and +3)"],
      ["mow", "Mow the whole field (+8, no Bonus cards)"],
    ]);
    if (c === "pluck") {
      await ctx.drawBonus(ctx.me, 2);
      await ctx.move(ctx.me, 3);
    } else await ctx.move(ctx.me, 8);
  },

  // Move to the CANOE. Roll higher than 3 to escape the rapids, or ride down to the BOAT.
  // (The engine resolves the Canoe space when the turn ends.)
  14: async (ctx) => {
    ctx.log("Oh no! You fall into the rapids!");
    await ctx.moveTo(ctx.me, ctx.spacesOfType("canoe")[0]);
  },

  // Force 2 other players to duel. Winner +4, loser back 4. Then collect a BONUS CARD and move +1.
  15: async (ctx) => {
    const fighters = ctx.others().filter((o) => !ctx.inNebula(o));
    if (fighters.length >= 2) {
      const a = await ctx.pickPlayer(ctx.me, "Pick the first player to force into a duel.", fighters);
      const b = a ? await ctx.pickPlayer(ctx.me, `Pick who ${ctx.name(a)} must duel.`, fighters.filter((f) => f !== a)) : null;
      if (a && b) {
        const [w, l] = await ctx.duel(a, b);
        await ctx.move(w, 4);
        await ctx.harm(l, async (who) => void (await ctx.move(who, -4)));
      }
    } else {
      ctx.log("There aren't two other players available to duel, so the duel is skipped.");
    }
    await ctx.drawBonus(ctx.me, 1);
    await ctx.move(ctx.me, 1);
  },

  // Move to the nearest star, or blow up the stars: roll a 2, 4 or 6 to go +8.
  16: async (ctx) => {
    const c = await ctx.choose(ctx.me, "Gaze at the stars, or blow them up?", [
      ["gaze", "Move to the nearest star"],
      ["blow", "Blow up the stars (roll a 2, 4 or 6 to go +8)"],
    ]);
    if (c === "gaze") {
      const mine = ctx.progress(ctx.me);
      const here = ctx.spaceId(ctx.me);
      let best: string | null = null;
      let bestD = Infinity;
      for (const s of ctx.spacesOfType("star")) {
        if (s === here) continue;
        const p = progress(ctx.board, { kind: "space", id: s });
        const d = Math.abs(p - mine) + (p < mine ? 0.5 : 0); // ties go to the star ahead
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) await ctx.moveTo(ctx.me, best);
    } else if (await ctx.rollFor(ctx.me, [2, 4, 6], "Blow up the stars! Roll a 2, 4 or 6 to go +8.")) {
      await ctx.move(ctx.me, 8);
    } else ctx.log("The stars shrug off the blast.");
  },

  // Fight the bear: roll 2, 4 or 6. Win: move to the DRAGON and fight. Lose: NEBULA for 1 turn.
  17: async (ctx) => {
    if (await ctx.rollFor(ctx.me, [2, 4, 6], "Fight the hungry bear! Roll a 2, 4 or 6.")) {
      ctx.log(`${ctx.name(ctx.me)} beat the bear! On to the DRAGON!`);
      await ctx.moveTo(ctx.me, ctx.spacesOfType("dragon-fight")[0]);
    } else {
      ctx.log(`${ctx.name(ctx.me)} is eaten by the bear and pooped out into the NEBULA.`);
      await ctx.harm(ctx.me, (who) => ctx.nebula(who, 1));
    }
  },

  // Collect a BONUS CARD and spin the SPINNER, or move to the nearest SAFE SPOT ahead of you.
  18: async (ctx) => {
    const safe = ctx.nextSpaceOfType(ctx.me, "safe");
    const opts: [string, string][] = [["spin", "Collect a Bonus card and spin the spinner"]];
    if (safe) opts.push(["safe", "Move to the nearest Safe Zone ahead"]);
    const c = await ctx.choose(ctx.me, "Some good luck. Your choice.", opts);
    if (c === "safe" && safe) await ctx.moveTo(ctx.me, safe);
    else {
      await ctx.drawBonus(ctx.me, 1);
      const seg = await ctx.spin(ctx.me, "action", "Spin the spinner for some good luck!");
      await doSegment(ctx, ctx.me, seg);
    }
  },

  // Dance-off (video call): 30 seconds against a player of your choice, the others vote.
  // Winner +11 and a BONUS CARD, loser back 2. Refuse to dance: skip your next turn.
  19: async (ctx) => {
    const c = await ctx.choose(ctx.me, "Challenge another player to a 30 second dance-off?", [
      ["dance", "Dance!"],
      ["coward", "Refuse (skip your next turn)"],
    ]);
    if (c !== "dance") {
      ctx.log(`${ctx.name(ctx.me)} is too much of a coward to dance.`);
      await ctx.harm(ctx.me, (who) => ctx.skip(who, 1));
      return;
    }
    const opp = await ctx.pickPlayer(ctx.me, "Who do you challenge to a dance-off?");
    if (!opp) {
      await ctx.move(ctx.me, 11);
      return;
    }
    await ctx.timer(ctx.me, 30, `${ctx.name(ctx.me)}: dance for 30 seconds!`);
    await ctx.timer(opp, 30, `${ctx.name(opp)}: your turn to dance for 30 seconds!`);
    let judges = ctx.others().filter((o) => o !== opp);
    if (judges.length === 0) judges = [opp];
    const votes = await ctx.vote(judges, "Who won the dance-off?", [
      [ctx.me, ctx.name(ctx.me)],
      [opp, ctx.name(opp)],
    ]);
    const tally = Object.values(votes);
    const mine = tally.filter((v) => v === ctx.me).length;
    const theirs = tally.filter((v) => v === opp).length;
    let winner: string;
    let loser: string;
    if (mine !== theirs) [winner, loser] = mine > theirs ? [ctx.me, opp] : [opp, ctx.me];
    else {
      ctx.log("The judges can't decide. Settle it with a duel!");
      [winner, loser] = await ctx.duel(ctx.me, opp);
    }
    ctx.log(`${ctx.name(winner)} wins the dance-off!`);
    await ctx.move(winner, 11);
    await ctx.drawBonus(winner, 1);
    await ctx.harm(loser, async (who) => void (await ctx.move(who, -2)));
  },

  // Basically just go +4. Math sucks.
  20: async (ctx) => {
    await ctx.move(ctx.me, 4);
  },

  // Spin the SPINNER in the middle of the players and exchange places with the player it points at.
  21: async (ctx) => {
    const others = ctx.others();
    if (others.length === 0) return;
    const seg = await ctx.spin(ctx.me, "color", "Spin! The arrow picks a player to swap places with.");
    const target = others[seg % others.length];
    ctx.log(`The arrow points at ${ctx.name(target)}!`);
    await ctx.harm(target, async () => ctx.swapPlaces(ctx.me, target));
  },

  // Rescue everyone stuck in the NEBULA and move +7, or leave them and move +2.
  // Nobody in the NEBULA? There is now! Go to the NEBULA.
  22: async (ctx) => {
    const stuck = ctx.others().filter((o) => ctx.inNebula(o));
    if (stuck.length === 0) {
      ctx.log("Nobody is in the NEBULA. There is now!");
      await ctx.harm(ctx.me, (who) => ctx.nebula(who, 1));
      return;
    }
    const names = stuck.map((s) => ctx.name(s)).join(", ");
    const c = await ctx.choose(ctx.me, `${names} ${stuck.length === 1 ? "is" : "are"} stuck in the NEBULA.`, [
      ["rescue", "Rescue them (move +7)"],
      ["leave", "Leave them to drift forever (move +2). You monster."],
    ]);
    if (c === "rescue") {
      for (const s of stuck) {
        ctx.game.leaveNebula(ctx.player(s));
        ctx.log(`${ctx.name(s)} was rescued from the NEBULA!`);
      }
      await ctx.move(ctx.me, 7);
    } else await ctx.move(ctx.me, 2);
  },

  // Move +3 or +5, or slither (and hiss) to the nearest BONUS CARD spot ahead of you.
  23: async (ctx) => {
    const bonus = ctx.nextSpaceOfType(ctx.me, "bonus");
    const opts: [string, string][] = [
      ["3", "Move +3"],
      ["5", "Move +5"],
    ];
    if (bonus) opts.push(["snake", "Slither like a sneaky snake to the next Bonus card space (you must hiss!)"]);
    const c = await ctx.choose(ctx.me, "How do you want to get around?", opts);
    if (c === "snake" && bonus) {
      const hiss = await ctx.askText(ctx.me, "Hiss like a sneaky snake as you slither across the board! Type your hiss.");
      ctx.log(`${ctx.name(ctx.me)} slithers: "${hiss || "Hissss..."}"`);
      await ctx.moveTo(ctx.me, bonus);
    } else await ctx.move(ctx.me, Number(c) || 3);
  },

  // Move +10. Keep this card: the next time you roll a 3, go to the NEBULA.
  24: async (ctx) => {
    await ctx.move(ctx.me, 10);
    const me = ctx.me;
    ctx.watch(me, "Next 3 rolled: blasted into the NEBULA", {
      onRoll: async (dice) => {
        if (!dice.includes(3)) return false;
        ctx.log(`${ctx.name(me)} rolled a 3 and blasts off to meet the NEBULA face to face!`);
        await ctx.harm(me, (who) => ctx.nebula(who, 1));
        return true;
      },
    });
    return "keep";
  },

  // Roll a 6 three times in a row and you win the game! But a 3 on any die means go back 1 space.
  25: async (ctx) => {
    let sixes = 0;
    for (let i = 1; i <= 3; i++) {
      const [d] = await ctx.roll(ctx.me, 1, `Roll a 6! (${i} of 3 in a row; a 3 sends you back 1)`);
      if (d === 3) await ctx.harm(ctx.me, async (who) => void (await ctx.move(who, -1)));
      if (d !== 6) break;
      sixes++;
    }
    if (sixes === 3) ctx.win(ctx.me);
    else ctx.log(`${ctx.name(ctx.me)} didn't get three 6s in a row. Maybe next time.`);
  },

  // Move +5, or send another player back 1, or collect a BONUS CARD, or fire the CANNON (spin: anyone on that color goes back 2),
  // or punch the player next to you and suffer the consequences.
  26: async (ctx) => {
    const opts: [string, string][] = [
      ["move", "Move +5"],
      ["back", "Send another player back 1"],
      ["bonus", "Collect a Bonus card"],
      ["cannon", "Fire the CANNON (anyone on the color it lands on goes back 2)"],
      ["punch", "Punch the player next to you (suffer the consequences)"],
    ];
    const c = await ctx.choose(ctx.me, "Pick one.", opts);
    if (c === "move") await ctx.move(ctx.me, 5);
    else if (c === "back") {
      const t = await ctx.pickPlayer(ctx.me, "Send who back 1 space?");
      if (t) await ctx.harm(t, async (who) => void (await ctx.move(who, -1)));
    } else if (c === "bonus") await ctx.drawBonus(ctx.me, 1);
    else if (c === "cannon") {
      const colors = await ctx.spinColor(ctx.me, "Fire the CANNON! Anyone on the color it lands on goes back 2.");
      await blast(ctx, colors, 2);
    } else {
      // The punch is mostly flavor: the consequences land on the puncher.
      const next = ctx.leftOf();
      ctx.log(`${ctx.name(ctx.me)} punches ${ctx.name(next)} right in the face! ${ctx.name(next)} punches back and throws ${ctx.name(ctx.me)} 3 spaces away.`);
      await ctx.harm(ctx.me, async (who) => void (await ctx.move(who, -3)));
    }
  },

  // Roll a 2, 4 or 6 to play a dream-like melody: all other players sleep for 2 turns. Otherwise you fall asleep for 2 turns.
  27: async (ctx) => {
    if (await ctx.rollFor(ctx.me, [2, 4, 6], "Play a sweet melody! Roll a 2, 4 or 6 to put everyone else to sleep.")) {
      for (const o of ctx.others().filter((o) => !ctx.inNebula(o))) await ctx.harm(o, (who) => ctx.skip(who, 2));
    } else {
      ctx.log(`${ctx.name(ctx.me)} fell asleep during their own song.`);
      await ctx.harm(ctx.me, (who) => ctx.skip(who, 2));
    }
  },
};
