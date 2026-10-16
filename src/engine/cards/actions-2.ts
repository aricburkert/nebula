import type { Ctx } from "../game";
import { doSegment, spinnerSegments } from "../spaces";
import type { CardScript } from "./index";

// Action cards 28-54.

/** Move back `n` as a harmful effect on whoever ends up suffering it. */
const goBack = (ctx: Ctx, n: number) => async (who: string) => {
  await ctx.move(who, -n);
};

/** Players who are on the board (not in the NEBULA). */
const targetable = (ctx: Ctx) => ctx.others().filter((o) => !ctx.inNebula(o));

/** Puts `who` on the same space as `other`. */
async function goToSpotOf(ctx: Ctx, who: string, other: string) {
  const pos = ctx.player(other).pos;
  if (pos.kind === "space") await ctx.moveTo(who, pos.id);
  else if (pos.kind === "start") await ctx.toStart(who);
}

/** The Action-card spinner: spin `times` times, doing each segment. */
async function spinActions(ctx: Ctx, times: number) {
  const me = ctx.me;
  for (let i = 0; i < times; i++) {
    if (ctx.inNebula(me)) break;
    const seg = await ctx.spin(me, "action", times > 1 ? `Spin the spinner! (${i + 1} of ${times})` : "Spin the spinner!");
    if (spinnerSegments[seg].action === "dragon-fight") {
      // The engine resolves the drawer's final landing space itself, so only fight here if another spin follows.
      await ctx.moveTo(me, ctx.spacesOfType("dragon-fight")[0]);
      if (i < times - 1) await ctx.resolveSpace(me);
    } else {
      await doSegment(ctx, me, seg);
    }
  }
}

export const ACTIONS_2: Record<number, CardScript> = {
  // Save someone from the NEBULA, move +5 (+1 for each additional person saved).
  // Or choose not to save anyone, move +2. Or go to the NEBULA.
  28: async (ctx) => {
    const trapped = ctx.others().filter((o) => ctx.inNebula(o));
    const opts: [string, string][] = [];
    if (trapped.length > 0) opts.push(["save", "Save someone from the NEBULA (+5, +1 for each extra person)"]);
    opts.push(["rat", "Save nobody: go +2"]);
    opts.push(["nebula", "Go to the NEBULA to see it for yourself"]);
    const pick = await ctx.choose(ctx.me, "Your Good Turn Daily! What will it be?", opts);
    if (pick === "save") {
      const remaining = [...trapped];
      const saved: string[] = [];
      while (remaining.length > 0) {
        const o: [string, string][] = remaining.map((p) => [p, `Save ${ctx.name(p)}`]);
        if (saved.length > 0) o.push(["done", "That's enough saving"]);
        const who = await ctx.choose(ctx.me, saved.length === 0 ? "Who do you pull out of the NEBULA?" : "Save anyone else?", o);
        if (who === "done") break;
        saved.push(who);
        remaining.splice(remaining.indexOf(who), 1);
        ctx.game.leaveNebula(ctx.player(who));
        ctx.log(`${ctx.name(ctx.me)} pulled ${ctx.name(who)} out of the NEBULA!`);
      }
      await ctx.move(ctx.me, 5 + Math.max(0, saved.length - 1));
    } else if (pick === "rat") {
      await ctx.move(ctx.me, 2);
    } else {
      await ctx.harm(ctx.me, (who) => ctx.nebula(who, 1));
    }
  },

  // A pink fairy: for every BONUS CARD you give her, fly +4. No cards to give: back 1 space.
  29: async (ctx) => {
    const have = ctx.hand(ctx.me).length;
    let n = 0;
    if (have > 0) {
      const opts: [string, string][] = [["0", "Give none (the fairy flies you back 1)"]];
      for (let i = 1; i <= have; i++) opts.push([String(i), `Give ${i} Bonus card${i === 1 ? "" : "s"}: go +${4 * i}`]);
      n = Number(await ctx.choose(ctx.me, `The pink fairy wants Bonus cards. You have ${have}. How many do you give her?`, opts));
    }
    if (n > 0) {
      ctx.loseBonus(ctx.me, n);
      await ctx.move(ctx.me, 4 * n);
    } else {
      await ctx.harm(ctx.me, goBack(ctx, 1));
    }
  },

  // Everyone rolls a 1, 2 or 3 to run for cover. Anyone hit (4-6) goes back 3.
  30: async (ctx) => {
    for (const p of ctx.onBoard()) {
      const safe = await ctx.rollFor(p, [1, 2, 3], "Meteorites! Roll a 1, 2 or 3 to run for cover.");
      if (safe) ctx.game.log(`${ctx.name(p)} ran for cover.`, { player: p });
      else await ctx.harm(p, goBack(ctx, 3), { text: "A flaming meteorite is about to hit you!" });
    }
  },

  // Move to the TROLL on the bridge and fight! (the engine resolves the landing space: the Troll Battle)
  31: async (ctx) => {
    await ctx.moveTo(ctx.me, ctx.spacesOfType("troll-battle")[0]);
  },

  // A turtle carries you to the BOAT. Roll a 2, 4 or 6 to swim upstream to the CANOE, or ride +2 spaces.
  32: async (ctx) => {
    await ctx.moveTo(ctx.me, ctx.spacesOfType("boat")[0]);
    const pick = await ctx.choose(ctx.me, "The turtle has carried you to the BOAT. What now?", [
      ["roll", "Fight the rapids: roll a 2, 4 or 6 to reach the CANOE"],
      ["slow", "Ride the turtle slowly: go +2"],
    ]);
    if (pick === "roll") {
      if (await ctx.rollFor(ctx.me, [2, 4, 6], "Roll a 2, 4 or 6 to swim upstream to the CANOE!")) {
        await ctx.moveTo(ctx.me, ctx.spacesOfType("canoe")[0]);
      } else {
        ctx.log(`${ctx.name(ctx.me)} couldn't fight the rapids and stays at the BOAT.`);
      }
    } else {
      await ctx.move(ctx.me, 2);
    }
  },

  // 30 seconds to do something funny. If anyone laughs: 2 BONUS CARDS and +7. Nobody laughs: back 3.
  33: async (ctx) => {
    await ctx.timer(ctx.me, 30, "Do something funny! Tell a joke, fart, fall on your face. Make someone laugh!");
    const votes = await ctx.vote(ctx.others(), `Did anyone laugh at ${ctx.name(ctx.me)}?`, [
      ["yes", "Yes, I laughed"],
      ["no", "Nope, not funny"],
    ]);
    if (Object.values(votes).includes("yes")) {
      await ctx.drawBonus(ctx.me, 2);
      await ctx.move(ctx.me, 7);
    } else {
      await ctx.harm(ctx.me, goBack(ctx, 3));
    }
  },

  // Go +1. Or go +2. Or go +3.
  34: async (ctx) => {
    const n = await ctx.choose(ctx.me, "Pick one. Yay! A decent card. I think?", [
      ["1", "Go +1"],
      ["2", "Go +2"],
      ["3", "Go +3"],
    ]);
    await ctx.move(ctx.me, Number(n));
  },

  // Roll a 1, 2 or 3 to spin the SPINNER once. Roll a 4, 5 or 6 to spin it twice.
  35: async (ctx) => {
    const [d] = await ctx.roll(ctx.me, 1, "Roll a die: 1-3 spins the SPINNER once, 4-6 spins it twice.");
    await spinActions(ctx, d <= 3 ? 1 : 2);
  },

  // Spear a hog: move +3 and collect a BONUS CARD.
  36: async (ctx) => {
    await ctx.move(ctx.me, 3);
    await ctx.drawBonus(ctx.me, 1);
  },

  // Are you addicted to coffee? Yes: +4 and a BONUS CARD. No: +1.
  37: async (ctx) => {
    const a = await ctx.choose(ctx.me, "Are you addicted to coffee?", [
      ["yes", "Yes (go +4 and collect a Bonus card)"],
      ["no", "No, why not? (go +1)"],
    ]);
    if (a === "yes") {
      await ctx.move(ctx.me, 4);
      await ctx.drawBonus(ctx.me, 1);
    } else {
      await ctx.move(ctx.me, 1);
    }
  },

  // Not gluten sensitive: +3. Gluten sensitive: go back 3.
  38: async (ctx) => {
    const a = await ctx.choose(ctx.me, "Are you gluten sensitive?", [
      ["no", "No, I'm fine (go +3)"],
      ["yes", "Yes, I'm gluten sensitive (go back 3)"],
    ]);
    if (a === "no") await ctx.move(ctx.me, 3);
    else await ctx.harm(ctx.me, goBack(ctx, 3));
  },

  // Roll 2 DICE and move, plus 2 from the cute cat.
  39: async (ctx) => {
    const sum = await ctx.rollSum(ctx.me, 2, "Roll 2 dice. The cat adds +2!");
    await ctx.move(ctx.me, sum + 2);
  },

  // Roll a 2, 4 or 6 to slap the seal: go +3. Otherwise the seal slaps you back 1 space.
  40: async (ctx) => {
    if (await ctx.rollFor(ctx.me, [2, 4, 6], "Roll a 2, 4 or 6 to slap the seal!")) await ctx.move(ctx.me, 3);
    else await ctx.harm(ctx.me, goBack(ctx, 1));
  },

  // Force a player of your choosing to move to your spot. If that was forward for them (you were nice), they also go +1.
  41: async (ctx) => {
    const me = ctx.me;
    const mine = ctx.player(me).pos;
    const candidates = targetable(ctx).filter((o) => {
      const p = ctx.player(o).pos;
      return !(p.kind === mine.kind && (p.kind !== "space" || (mine.kind === "space" && p.id === mine.id)));
    });
    if (candidates.length === 0) {
      ctx.log("Nobody can be moved to that spot.");
      return;
    }
    const target = await ctx.pickPlayer(me, "Force which player to move to your spot?", candidates);
    if (!target) return;
    if (ctx.progress(target) < ctx.progress(me)) {
      // Moving forward for them: that was nice, so a bonus +1 and no defending.
      await goToSpotOf(ctx, target, me);
      await ctx.move(target, 1);
    } else {
      await ctx.harm(target, async (who) => {
        await goToSpotOf(ctx, who, who === target ? me : target);
      });
    }
  },

  // Choose 2 players who get their toes bashed and lose their next turn.
  42: async (ctx) => {
    const cands = targetable(ctx);
    let targets: string[] = cands;
    if (cands.length > 2) {
      const first = await ctx.pickPlayer(ctx.me, "Bash the toes of the first player.", cands);
      const rest = cands.filter((c) => c !== first);
      const second = await ctx.pickPlayer(ctx.me, "And the second player.", rest);
      targets = [first, second].filter((t): t is string => t !== null);
    }
    for (const t of targets) await ctx.harm(t, (who) => ctx.skip(who, 1), { text: "Someone is about to bash your toes with a hammer!" });
  },

  // 30 second staring contest with another player. First to smile or laugh loses. Winner +5, loser -2, tie: both -2.
  43: async (ctx) => {
    const me = ctx.me;
    const opp = await ctx.pickPlayer(me, "Pick a player for a staring contest.", targetable(ctx));
    if (!opp) return;
    await ctx.timer(me, 30, `Staring contest with ${ctx.name(opp)}! First to smile or laugh loses.`);
    const spectators = ctx.others().filter((o) => o !== opp);
    const voters = spectators.length > 0 ? spectators : [me, opp];
    const result = await ctx.majority(voters, `Staring contest: ${ctx.name(me)} vs ${ctx.name(opp)}. What happened?`, [
      ["tie", "Tie (or both cracked)"],
      ["me", `${ctx.name(me)} smiled or laughed first`],
      ["opp", `${ctx.name(opp)} smiled or laughed first`],
    ]);
    if (result === "me") {
      await ctx.move(opp, 5);
      await ctx.harm(me, goBack(ctx, 2));
    } else if (result === "opp") {
      await ctx.move(me, 5);
      await ctx.harm(opp, goBack(ctx, 2));
    } else {
      await ctx.harm(me, goBack(ctx, 2));
      await ctx.harm(opp, goBack(ctx, 2));
    }
  },

  // Collect a BONUS CARD and +3, or forgo the card and +6, or save this card to add +7 to your next DICE roll.
  44: async (ctx) => {
    const a = await ctx.choose(ctx.me, "Your choice:", [
      ["bonus", "Collect a Bonus card and go +3"],
      ["six", "Forgo the Bonus card and go +6"],
      ["save", "Save this card: +7 on your next dice roll"],
    ]);
    if (a === "bonus") {
      await ctx.drawBonus(ctx.me, 1);
      await ctx.move(ctx.me, 3);
    } else if (a === "six") {
      await ctx.move(ctx.me, 6);
    } else {
      const me = ctx.me;
      const cur = ctx.player(me).flags.rollBonus;
      ctx.setFlag(me, "rollBonus", (typeof cur === "number" ? cur : 0) + 7);
      // The engine adds the rollBonus flag to the next roll; this watcher just keeps the card on display until then.
      ctx.watch(me, "+7 on your next dice roll", { onRoll: async () => true });
      return "keep";
    }
  },

  // Roll a DIE. Now move backwards that amount.
  45: async (ctx) => {
    const d = await ctx.rollSum(ctx.me, 1, "Roll a die and move backwards that many spaces. HA HA HA! Loser!");
    await ctx.harm(ctx.me, goBack(ctx, d));
  },

  // Beard judging. Baby boy beard +1, respectable gentleman's beard +6, majestic wizard beard +10, no beard -2.
  46: async (ctx) => {
    const options: [string, string][] = [
      ["none", "No beard at all (back 2)"],
      ["baby", "Little baby boy beard (+1)"],
      ["gentleman", "Respectable gentleman's beard (+6)"],
      ["wizard", "Majestic wizard beard (+10)"],
    ];
    let tier: string | null;
    const judges = ctx.others();
    if (judges.length > 0) tier = await ctx.majority(judges, `Judge ${ctx.name(ctx.me)}'s beard!`, options);
    else tier = await ctx.choose(ctx.me, "How's your beard?", options);
    if (tier === "baby") await ctx.move(ctx.me, 1);
    else if (tier === "gentleman") await ctx.move(ctx.me, 6);
    else if (tier === "wizard") await ctx.move(ctx.me, 10);
    else await ctx.harm(ctx.me, goBack(ctx, 2));
  },

  // Everybody rolls one DIE. Highest wins: +7 (and gets to make fun of everyone else).
  47: async (ctx) => {
    let contenders = ctx.onBoard();
    for (let guard = 0; guard < 20 && contenders.length > 1; guard++) {
      const rolls: Record<string, number> = {};
      for (const p of contenders) rolls[p] = await ctx.rollSum(p, 1, "Duel Everyone! Highest roll wins.");
      const top = Math.max(...Object.values(rolls));
      contenders = contenders.filter((p) => rolls[p] === top);
      if (contenders.length > 1) ctx.log("A tie for the highest roll! The tied players roll again.");
    }
    const winner = contenders[0];
    if (winner) {
      ctx.log(`${ctx.name(winner)} wins the duel and gets to make fun of everyone else for 1 turn.`);
      await ctx.move(winner, 7);
    }
  },

  // Phone Wars. Most represented brand +4; everyone else -1; flip phones go to the NEBULA.
  48: async (ctx) => {
    const votes = await ctx.vote(ctx.players(), "Phone Wars! What kind of phone do you have?", [
      ["apple", "iPhone (Apple)"],
      ["samsung", "Samsung"],
      ["google", "Google Pixel"],
      ["other", "Another brand"],
      ["flip", "A flip phone"],
    ]);
    const brand = (p: string) => votes[p] ?? "other";
    const counts = new Map<string, number>();
    for (const p of ctx.players()) {
      const b = brand(p);
      if (b !== "flip") counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const top = Math.max(0, ...counts.values());
    for (const p of ctx.players()) {
      const b = brand(p);
      if (b === "flip") await ctx.harm(p, (who) => ctx.nebula(who, 1));
      else if ((counts.get(b) ?? 0) === top && top > 0) await ctx.move(p, 4);
      else await ctx.harm(p, goBack(ctx, 1));
    }
  },

  // Stink Boy: +2, or +5.
  49: async (ctx) => {
    const n = await ctx.choose(ctx.me, "Stink Boy asks you for directions.", [
      ["2", "Take a happy skipperoo: go +2"],
      ["5", "Take a deep breath of his stink: go +5"],
    ]);
    await ctx.move(ctx.me, Number(n));
  },

  // The Moon dips behind the clouds: +1, or swat the clouds away and +3.
  50: async (ctx) => {
    const n = await ctx.choose(ctx.me, "The Moon dips behind the clouds.", [
      ["1", "Go +1"],
      ["3", "Swat the clouds away and go +3"],
    ]);
    await ctx.move(ctx.me, Number(n));
  },

  // Harsh winter storm: a BONUS CARD and +3, or roll a 2, 4 or 6 for +8 and a BONUS CARD; otherwise next turn skipped.
  51: async (ctx) => {
    const a = await ctx.choose(ctx.me, "A harsh winter storm moves in.", [
      ["safe", "Collect a warm Bonus card and go +3"],
      ["gamble", "Chance the cold: roll a 2, 4 or 6 for +8 and a Bonus card (else frozen, skip a turn)"],
    ]);
    if (a === "safe") {
      await ctx.drawBonus(ctx.me, 1);
      await ctx.move(ctx.me, 3);
    } else if (await ctx.rollFor(ctx.me, [2, 4, 6], "Roll a 2, 4 or 6 to brave the freezing weather!")) {
      await ctx.move(ctx.me, 8);
      await ctx.drawBonus(ctx.me, 1);
    } else {
      await ctx.harm(ctx.me, (who) => ctx.skip(who, 1));
    }
  },

  // If you can fart right now: +16 and 3 BONUS CARDS (dignity lost). Otherwise keep your dignity and go +2.
  52: async (ctx) => {
    const a = await ctx.choose(ctx.me, "Fart Challenge. Can you physically fart right now, in front of everyone?", [
      ["fart", "Yes! (+16 and 3 Bonus cards, no dignity)"],
      ["dignity", "No, I keep my dignity (+2)"],
    ]);
    let did = a === "fart";
    if (did && ctx.others().length > 0) {
      // Only the others can check: they must back you up, or you get the dignity option.
      const verdict = await ctx.majority(ctx.others(), `${ctx.name(ctx.me)} says they just farted. Did they?`, [
        ["no", "Nope, I didn't notice"],
        ["yes", "Yes, we all heard it"],
      ]);
      did = verdict === "yes";
    }
    if (did) {
      await ctx.move(ctx.me, 16);
      await ctx.drawBonus(ctx.me, 3);
    } else {
      await ctx.move(ctx.me, 2);
    }
  },

  // Marathon: run +5, or throw a boulder at a player (they skip 2 turns) and also go +1.
  53: async (ctx) => {
    const targets = targetable(ctx);
    const opts: [string, string][] = [["run", "Run +5 and finish with dignity"]];
    if (targets.length > 0) opts.push(["boulder", "Throw a boulder at a player (they skip 2 turns) and go +1"]);
    const a = await ctx.choose(ctx.me, "You are running in a marathon. You are not doing well.", opts);
    if (a === "run") {
      await ctx.move(ctx.me, 5);
      return;
    }
    const t = await ctx.pickPlayer(ctx.me, "Who gets a boulder to the leg?", targets);
    if (t) await ctx.harm(t, (who) => ctx.skip(who, 2), { text: "Someone is throwing a boulder at your leg!" });
    await ctx.move(ctx.me, 1);
  },

  // The vine snaps: your next turn is skipped, but a get-well-soon card brings 2 BONUS CARDS.
  54: async (ctx) => {
    await ctx.harm(ctx.me, (who) => ctx.skip(who, 1));
    await ctx.drawBonus(ctx.me, 2);
  },
};
