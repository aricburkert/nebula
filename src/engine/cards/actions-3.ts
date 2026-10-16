import type { Ctx } from "../game";
import { space, stepBack } from "../board";
import { doSegment } from "../spaces";
import type { CardScript } from "./index";

/** Asks the other players for a verdict; with nobody else around the player self-reports. Defaults to the first option. */
async function report(ctx: Ctx, text: string, options: [string, string][]): Promise<string> {
  const voters = ctx.others(ctx.me);
  const answer = voters.length ? await ctx.majority(voters, text, options) : await ctx.choose(ctx.me, text, options);
  return answer ?? options[0][0];
}

/** Nearest space of the same color ahead of and behind a player (for Color Warp!). */
function colorWarpTargets(ctx: Ctx, pid: string): { fwd: [string, number] | null; back: [string, number] | null } {
  const board = ctx.board;
  const branch = ctx.player(pid).branch;
  const here = ctx.spaceId(pid);
  const color = ctx.color(pid);
  if (!here || !color) return { fwd: null, back: null };
  let fwd: [string, number] | null = null;
  let id = here;
  for (let n = 1; ; n++) {
    const nx = space(board, id).next.filter((x) => x !== "finish");
    if (nx.length === 0) break;
    id = nx.length === 1 ? nx[0] : (nx.find((x) => space(board, x).path === branch) ?? nx[0]);
    if (space(board, id).color === color) {
      fwd = [id, n];
      break;
    }
  }
  let back: [string, number] | null = null;
  let cur: string = here;
  for (let n = 1; ; n++) {
    const prev = stepBack(board, cur, branch);
    if (prev === "start") break;
    cur = prev;
    if (space(board, cur).color === color) {
      back = [cur, n];
      break;
    }
  }
  return { fwd, back };
}

// Action cards 55-82.
export const ACTIONS_3: Record<number, CardScript> = {
  // Show off your skills: juggle 3 DICE for 4 seconds +7; balance a DIE on your nose for 4 seconds +5; crack your knuckles +1; can't do any? Back 2.
  55: async (ctx) => {
    const me = ctx.me;
    const pick = await ctx.choose(me, "Impress the other players! Which stunt do you attempt?", [
      ["juggle", "Juggle 3 dice for 4 seconds (+7)"],
      ["balance", "Balance a die on your nose for 4 seconds (+5)"],
      ["knuckles", "Crack your knuckles (+1)"],
      ["none", "I can't do any of these (back 2)"],
    ]);
    let result = pick;
    if (pick === "juggle" || pick === "balance") {
      await ctx.timer(me, 4, pick === "juggle" ? "Juggle 3 dice for 4 seconds!" : "Balance a die on your nose for 4 seconds!");
      const ok = await report(ctx, `Did ${ctx.name(me)} ${pick === "juggle" ? "juggle 3 dice for 4 seconds" : "balance a die on their nose for 4 seconds"}?`, [
        ["yes", "Yes!"],
        ["no", "No"],
      ]);
      if (ok === "no") {
        // Failed the stunt: they can still crack their knuckles, or give up.
        result = await ctx.choose(me, "The stunt failed. Crack your knuckles instead, or give up?", [
          ["knuckles", "Crack your knuckles (+1)"],
          ["none", "Give up (back 2)"],
        ]);
      }
    }
    if (result === "juggle") await ctx.move(me, 7);
    else if (result === "balance") await ctx.move(me, 5);
    else if (result === "knuckles") await ctx.move(me, 1);
    else await ctx.harm(me, (who) => ctx.move(who, -2).then(() => undefined));
  },

  // Step on an ant nest: +3. Or eat the ants: +11, but the next time you roll a 5 this game, go to the NEBULA. Hold onto this card.
  56: async (ctx) => {
    const me = ctx.me;
    const pick = await ctx.choose(me, "You step on an ant's nest!", [
      ["run", "Run from the ants (+3)"],
      ["eat", "Eat the ants (+11, but the next 5 you roll sends you to the NEBULA)"],
    ]);
    if (pick === "run") {
      await ctx.move(me, 3);
      return;
    }
    await ctx.move(me, 11);
    ctx.watch(me, "Next 5 rolled: dragged back into the ants nest (NEBULA)", {
      onRoll: async (dice) => {
        if (!dice.includes(5)) return false;
        ctx.log(`${ctx.name(me)} rolled a 5 and is dragged back into the ants' nest!`);
        await ctx.harm(me, (who) => ctx.nebula(who, 1));
        return true;
      },
    });
    return "keep";
  },

  // Energy drink: roll 3 DICE and go that far.
  57: async (ctx) => {
    await ctx.move(ctx.me, await ctx.rollSum(ctx.me, 3, "POWER! Roll 3 dice and go as far as you can."));
  },

  // Ask the others if you spend too much time researching purchases. Majority yes: -1. Majority no: +4. Don't know you: -3. A kid with no money: +3.
  58: async (ctx) => {
    const me = ctx.me;
    const kid = await ctx.choose(me, "Are you just a kid who doesn't have any money?", [
      ["no", "No, let the others judge"],
      ["kid", "Yes, I'm a kid with no money (+3)"],
    ]);
    if (kid === "kid") {
      await ctx.move(me, 3);
      return;
    }
    const voters = ctx.others(me);
    const verdict = voters.length
      ? await ctx.majority(voters, `Does ${ctx.name(me)} spend too much time researching something they want to buy?`, [
          ["yes", "Yes"],
          ["no", "No"],
          ["dk", "I don't know them well enough"],
        ])
      : null;
    if (verdict === "yes") await ctx.harm(me, (who) => ctx.move(who, -1).then(() => undefined));
    else if (verdict === "no") await ctx.move(me, 4);
    else if (verdict === "dk") await ctx.harm(me, (who) => ctx.move(who, -3).then(() => undefined));
  },

  // We have seen your future, it looks grim: +3. Or punch destiny in the mouth: +7.
  59: async (ctx) => {
    const pick = await ctx.choose(ctx.me, "We have seen your future, and boy does it look grim.", [
      ["grim", "Accept your fate (+3)"],
      ["punch", "Punch destiny in the mouth (+7)"],
    ]);
    await ctx.move(ctx.me, pick === "punch" ? 7 : 3);
  },

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

  // Eagle ride: give 1+ BONUS CARDS to the player on your left, +4 for each card given. No BONUS CARDS: back 1.
  61: async (ctx) => {
    const me = ctx.me;
    const have = ctx.hand(me).length;
    if (have === 0) {
      ctx.log("No Bonus cards to pay the eagle. It poops on your head!");
      await ctx.harm(me, (who) => ctx.move(who, -1).then(() => undefined));
      return;
    }
    const left = ctx.leftOf(me);
    const opts: [string, string][] = [["0", "Pay nothing (stay put)"]];
    for (let i = 1; i <= have; i++) opts.push([String(i), `Give ${i} Bonus card${i === 1 ? "" : "s"} (+${4 * i})`]);
    const n = Number(await ctx.choose(me, `A majestic eagle offers you a ride. How many Bonus cards do you give ${ctx.name(left)}? (+4 each)`, opts));
    if (n > 0) {
      ctx.takeBonus(me, left, n);
      await ctx.move(me, 4 * n);
    }
  },

  // Everyone adds +2 to their next DICE roll or ACTION CARD.
  62: async (ctx) => {
    for (const p of ctx.players()) ctx.setFlag(p, "rollBonus", 2);
    ctx.log("Shrooms! Everyone adds +2 to their next roll.");
  },

  // (removed online) Duel a player with DICE. Winner +2 or +5 and sends a photo to the loser's last text; a loser who refuses sits in silence for 2 turns.
  63: async (ctx) => {
    const me = ctx.me;
    const opp = await ctx.pickPlayer(me, "Choose a player to duel. Roll dice to see who wins.", ctx.others(me).filter((o) => !ctx.inNebula(o)));
    if (!opp) return;
    const [w, l] = await ctx.duel(me, opp);
    const bonus = await ctx.choose(w, "You won! Send a photo of yourself to the last person the loser texted, and go...", [
      ["2", "+2"],
      ["5", "+5"],
    ]);
    await ctx.move(w, Number(bonus));
    const ok = await ctx.choose(l, `${ctx.name(w)} wants to send a photo of themselves to the last person you texted. Allow it?`, [
      ["yes", "Allow it"],
      ["no", "Refuse (sit out 2 turns)"],
    ]);
    if (ok === "no") await ctx.harm(l, (who) => ctx.skip(who, 2));
  },

  // Warp between the colors: move forward or backwards to the closest space of the same color.
  64: async (ctx) => {
    const me = ctx.me;
    const { fwd, back } = colorWarpTargets(ctx, me);
    let dest: string | null = null;
    if (fwd && back) {
      if (fwd[1] < back[1]) dest = fwd[0];
      else if (back[1] < fwd[1]) dest = back[0];
      else dest = await ctx.pickSpace(me, "Two spaces of your color are equally close. Which one do you warp to?", [fwd[0], back[0]]);
    } else dest = fwd?.[0] ?? back?.[0] ?? null;
    if (dest) await ctx.moveTo(me, dest);
    else ctx.log(`${ctx.name(me)} has no color to warp along.`);
  },

  // Toss and catch this card with an open palm: +7 and a BONUS CARD. Drop it: back 1. Barely toss it: back 2.
  65: async (ctx) => {
    const me = ctx.me;
    await ctx.timer(me, 10, "Toss a card up and catch it with an open palm! Don't be a loser.");
    const res = await report(ctx, `How did ${ctx.name(me)}'s card toss go?`, [
      ["caught", "Caught it with a proper toss"],
      ["dropped", "Dropped it"],
      ["barely", "Barely tossed it, like a loser"],
    ]);
    if (res === "caught") {
      await ctx.move(me, 7);
      await ctx.drawBonus(me, 1);
    } else if (res === "dropped") await ctx.harm(me, (who) => ctx.move(who, -1).then(() => undefined));
    else await ctx.harm(me, (who) => ctx.move(who, -2).then(() => undefined));
  },

  // Spin the SPINNER twice.
  66: async (ctx) => {
    for (let i = 0; i < 2; i++) {
      const seg = await ctx.spin(ctx.me, "action", `Spin ${i + 1} of 2.`);
      await doSegment(ctx, ctx.me, seg);
      if (ctx.inNebula(ctx.me)) break;
    }
  },

  // Quicksand: others roll a 2 or 4 to save you (they get a BONUS CARD, you go +1). Otherwise back to START.
  67: async (ctx) => {
    const me = ctx.me;
    let saved = false;
    for (const h of ctx.others(me).filter((o) => !ctx.inNebula(o))) {
      const help = await ctx.choose(h, `${ctx.name(me)} is sinking in quicksand and yelling for help! Try to save them?`, [
        ["help", "Help! (roll a 2 or 4)"],
        ["ignore", "Ignore them"],
      ]);
      if (help !== "help") continue;
      if (await ctx.rollFor(h, [2, 4], `Roll a 2 or 4 to pull ${ctx.name(me)} out of the quicksand!`)) {
        await ctx.drawBonus(h, 1);
        saved = true;
        break;
      }
    }
    if (saved) {
      ctx.log(`${ctx.name(me)} was saved from the quicksand!`);
      await ctx.move(me, 1);
    } else {
      ctx.log(`Nobody saved ${ctx.name(me)}. Sink back to START!`);
      await ctx.harm(me, (who) => ctx.toStart(who));
    }
  },

  // Roll all 6 DICE. First to add them correctly wins +6. Everyone else back 1. A wrong answer is a trip to the NEBULA.
  68: async (ctx) => {
    const dice = await ctx.roll(ctx.me, 6, "Roll all 6 dice! Everyone races to add them up.");
    const { winner, wrong } = await ctx.race(ctx.players(), dice, "Add up all 6 dice! First correct answer wins. A wrong answer sends you to the NEBULA.");
    if (winner) await ctx.move(winner, 6);
    for (const p of wrong) await ctx.harm(p, (who) => ctx.nebula(who, 1));
    for (const p of ctx.players()) {
      if (p === winner || wrong.includes(p)) continue;
      await ctx.harm(p, (who) => ctx.move(who, -1).then(() => undefined));
    }
  },

  // Roll a 2, 4, or 6 to escape the troll's hook: +3. Otherwise go to the TROLL on the bridge and battle him.
  69: async (ctx) => {
    if (await ctx.rollFor(ctx.me, [2, 4, 6], "The angry troll is fishing for you! Roll a 2, 4 or 6 to escape his hook.")) {
      await ctx.move(ctx.me, 3);
    } else {
      // The engine resolves the Troll Battle when the turn ends.
      const troll = ctx.spacesOfType("troll-battle")[0];
      await ctx.moveTo(ctx.me, troll);
    }
  },

  // Roll a 2, 4, or 6 to take a shortcut to the closest SAFE ZONE ahead. If not, stay.
  70: async (ctx) => {
    if (await ctx.rollFor(ctx.me, [2, 4, 6], "Roll a 2, 4 or 6 to take the shortcut to the next Safe Zone!")) {
      const safe = ctx.nextSpaceOfType(ctx.me, "safe");
      if (safe) await ctx.moveTo(ctx.me, safe);
      else ctx.log("There is no Safe Zone ahead.");
    }
  },

  // Take 1 BONUS CARD from another player, or take 1 ACTION CARD, or +7, or go to the NEBULA and when you get out go +5.
  71: async (ctx) => {
    const me = ctx.me;
    const victims = ctx.others(me).filter((o) => ctx.hand(o).length > 0);
    const options: [string, string][] = [];
    if (victims.length) options.push(["steal", "Take 1 Bonus card from another player"]);
    options.push(["action", "Take 1 Action card from the deck"], ["move", "Just go +7"], ["nebula", "Go to the NEBULA, then go +5 when you get out"]);
    const pick = await ctx.choose(me, "Choose one.", options);
    if (pick === "steal") {
      const t = await ctx.pickPlayer(me, "Take a Bonus card from who?", victims);
      if (t) await ctx.harm(t, (who) => void ctx.takeBonus(who === t ? t : me, who === t ? me : t, 1));
    } else if (pick === "action") {
      await ctx.drawAction(me);
    } else if (pick === "move") {
      await ctx.move(me, 7);
    } else {
      // The engine applies flag "nebulaExitBonus" when the player leaves the NEBULA.
      await ctx.harm(me, (who) => {
        ctx.nebula(who, 1);
        ctx.setFlag(who, "nebulaExitBonus", 5);
      });
    }
  },

  // Whistle a happy tune: +3. Or whistle a crappy tune: +1.
  72: async (ctx) => {
    const pick = await ctx.choose(ctx.me, "Whistle a tune for everyone!", [
      ["happy", "Whistle a happy tune (+3)"],
      ["crappy", "Whistle a crappy tune (+1)"],
    ]);
    await ctx.move(ctx.me, pick === "happy" ? 3 : 1);
  },

  // Sarcastically encourage each player for the next full turn: +7. Can't find anything nice to say: +1.
  73: async (ctx) => {
    const me = ctx.me;
    const pick = await ctx.choose(me, "Sarcastically encourage each player. Can you find something to say?", [
      ["yes", "Encourage everyone (+7)"],
      ["no", "Can't find anything nice to say (+1)"],
    ]);
    if (pick === "no") {
      await ctx.move(me, 1);
      return;
    }
    let said = 0;
    for (const o of ctx.others(me)) {
      const msg = (await ctx.askText(me, `Type some sarcastic encouragement for ${ctx.name(o)}.`)).trim();
      if (msg) {
        said++;
        ctx.log(`${ctx.name(me)} to ${ctx.name(o)}: "${msg}"`);
      }
    }
    await ctx.move(me, said > 0 || ctx.others(me).length === 0 ? 7 : 1);
  },

  // Hold all 6 DICE, close your eyes, stack them in 30 seconds. Success +5, fail -2, opened your eyes: back to START.
  74: async (ctx) => {
    const me = ctx.me;
    await ctx.timer(me, 30, "Eyes closed! You have 30 seconds to stack all 6 dice on top of each other.");
    const res = await report(ctx, `How did ${ctx.name(me)}'s blind dice stacking go?`, [
      ["success", "They stacked them!"],
      ["fail", "They failed"],
      ["cheat", "They opened their eyes (cheater!)"],
    ]);
    if (res === "success") await ctx.move(me, 5);
    else if (res === "fail") await ctx.harm(me, (who) => ctx.move(who, -2).then(() => undefined));
    else await ctx.harm(me, (who) => ctx.toStart(who));
  },

  // Go +7 and collect a BONUS CARD. The next time anyone catches you saying "um" or "like", you go to the NEBULA.
  75: async (ctx) => {
    const me = ctx.me;
    await ctx.move(me, 7);
    await ctx.drawBonus(me, 1);
    ctx.watch(me, 'Don\'t say "um" or "like"! Anyone can catch you', {
      gotcha: {
        by: "others",
        apply: () => ctx.nebula(me, 1),
      },
    });
    return "keep";
  },

  // When were you born? After 2004: back 3. 1980-2004: NEBULA for 2 turns. 1960-1980: nothing. Before 1960: +5.
  76: async (ctx) => {
    const me = ctx.me;
    const pick = await ctx.choose(me, "When were you born?", [
      ["z", "2005 or later"],
      ["mil", "1980 - 2004"],
      ["x", "1960 - 1979"],
      ["boomer", "Before 1960"],
    ]);
    if (pick === "z") await ctx.harm(me, (who) => ctx.move(who, -3).then(() => undefined));
    else if (pick === "mil") await ctx.harm(me, (who) => ctx.nebula(who, 2));
    else if (pick === "boomer") await ctx.move(me, 5);
    else ctx.log("Gen X is ignored, as usual.");
  },

  // Everyone burps once. Loudest +6, lamest back 2, the rest stay.
  77: async (ctx) => {
    const everyone = ctx.players();
    for (const p of everyone) await ctx.timer(p, 5, `${ctx.name(p)}: your turn to burp! Make it count.`);
    const options = everyone.map((p): [string, string] => [p, ctx.name(p)]);
    const loudest = await ctx.majority(everyone, "Who made the LOUDEST burp?", options);
    const lamest = await ctx.majority(
      everyone,
      "Who made the LAMEST burp?",
      options.filter(([p]) => p !== loudest),
    );
    if (loudest) await ctx.move(loudest, 6);
    if (lamest && lamest !== loudest) await ctx.harm(lamest, (who) => ctx.move(who, -2).then(() => undefined));
  },

  // Read the sentences without anyone laughing: everyone +3. Anyone laughed: everyone back 1.
  78: async (ctx) => {
    const me = ctx.me;
    const sentences = [
      "The palpable papa ponders paddling properly.",
      "Pesky parents properly pursue pepperoni pizza.",
      "Popping pickles pleases the palisade pagans.",
      "Perfect pictures of pies panics the promiscuous pandering pajama poodles.",
      "Painful poo poos placate pangs of poisoned pillaged pesto.",
    ];
    const text = sentences[ctx.game.rng.int(sentences.length)];
    await ctx.timer(me, 30, `Read this out loud with a straight face: "${text}"`);
    const watchers = ctx.others(me);
    let laughed = false;
    if (watchers.length) {
      const votes = await ctx.vote(watchers, "Did anyone laugh?", [
        ["laughed", "Someone laughed"],
        ["fine", "Nobody laughed"],
      ]);
      laughed = Object.values(votes).includes("laughed");
    }
    if (laughed) {
      for (const p of ctx.players()) await ctx.harm(p, (who) => ctx.move(who, -1).then(() => undefined));
    } else {
      for (const p of ctx.players()) await ctx.move(p, 3);
    }
  },

  // Win right now by leaving the party. Or move +1.
  79: async (ctx) => {
    const pick = await ctx.choose(ctx.me, "You can win the game right now, but you have to leave the party and go home. No turning back. Leave?", [
      ["win", "Win and leave the game"],
      ["move", "Move +1"],
    ]);
    if (pick === "win") ctx.win(ctx.me);
    else await ctx.move(ctx.me, 1);
  },

  // Roll a 2, 4, or 6 to swat the HIPPO BEES away: +4. Failure: nothing but pain.
  80: async (ctx) => {
    if (await ctx.rollFor(ctx.me, [2, 4, 6], "Hippo bees attack! Roll a 2, 4 or 6 to swat them away.")) {
      await ctx.move(ctx.me, 4);
    } else ctx.log("Nothing but pain.");
  },

  // 30 seconds to build the house of cards: +7 and a BONUS CARD. Fail: -2.
  81: async (ctx) => {
    const me = ctx.me;
    await ctx.timer(me, 30, "Build the house of cards in 30 seconds!");
    const ok = await report(ctx, `Did ${ctx.name(me)} build the house of cards?`, [
      ["yes", "Yes, it stands!"],
      ["no", "No, it fell"],
    ]);
    if (ok === "yes") {
      await ctx.move(me, 7);
      await ctx.drawBonus(me, 1);
    } else await ctx.harm(me, (who) => ctx.move(who, -2).then(() => undefined));
  },

  // Challenge another player to a duel. Both roll 1 DIE at once: first to roll a 6 shoots the other into the NEBULA. Winner +5 or +7 and a BONUS CARD.
  82: async (ctx) => {
    const me = ctx.me;
    const opp = await ctx.pickPlayer(me, "High Noon! Challenge which player to a duel?", ctx.others(me).filter((o) => !ctx.inNebula(o)));
    if (!opp) return;
    let winner: string | null = null;
    for (let i = 0; i < 50 && !winner; i++) {
      const [a] = await ctx.roll(me, 1, `High Noon vs ${ctx.name(opp)}: roll a 6 first!`);
      const [b] = await ctx.roll(opp, 1, `High Noon vs ${ctx.name(me)}: roll a 6 first!`);
      if (a === 6 && b !== 6) winner = me;
      else if (b === 6 && a !== 6) winner = opp;
      else if (a === 6 && b === 6) ctx.log("Both shot at once! Draw again.");
    }
    if (!winner) return;
    const loser = winner === me ? opp : me;
    ctx.log(`${ctx.name(winner)} shoots ${ctx.name(loser)} out of the saloon!`);
    await ctx.harm(loser, (who) => ctx.nebula(who, 1));
    const reward = await ctx.choose(winner, "You won the duel! Go...", [
      ["5", "+5"],
      ["7", "+7"],
    ]);
    await ctx.move(winner, Number(reward));
    await ctx.drawBonus(winner, 1);
  },
};
