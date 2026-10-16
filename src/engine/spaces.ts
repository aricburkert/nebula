import spinner from "../../data/spinner-standard.json";
import { space } from "./board";
import type { Ctx } from "./game";
import type { Color } from "./types";

export interface Segment {
  action: string;
  text: string;
  color: Color | Color[];
}

export const spinnerSegments = spinner.segments as Segment[];

interface SpaceEffect {
  roll?: number[];
  success?: { teleport: string };
  fail?: { teleport: string };
  teleport?: string;
}

/** Resolves the space a player is standing on. */
export async function resolveSpace(ctx: Ctx, pid: string, depth = 0): Promise<void> {
  const g = ctx.game;
  const p = g.player(pid);
  if (p.pos.kind !== "space" || depth > 3) return;
  const sp = space(g.board, p.pos.id) as ReturnType<typeof space> & { effect?: SpaceEffect };
  const name = p.name;
  switch (sp.type) {
    case "bonus":
      await ctx.drawBonus(pid, 1);
      return;
    case "spinner": {
      const seg = await g.spin(pid, "action", "You landed on Spin the Spinner!", "Spin the Spinner");
      await doSegment(ctx, pid, seg);
      return;
    }
    case "nebula":
      await ctx.harm(pid, (who) => ctx.nebula(who, 1), { source: "board", text: "The NEBULA is sucking you in!" });
      return;
    case "troll-fight":
      await g.moveTo(pid, sp.effect!.teleport!);
      return resolveSpace(ctx, pid, depth + 1);
    case "cannon": {
      const colors = await ctx.spinColor(pid, "Fire the CANNON! Everyone on the color it lands on goes back 3.");
      await cannonBlast(ctx, colors, 3);
      return;
    }
    case "dragon-fight":
      return dragonFight(ctx, pid);
    case "canoe": {
      const ok = await g.roll(pid, 1, "Roll higher than 3 to escape the rapids!", "Canoe").then(([d]) => d > 3);
      if (ok) {
        g.log(`${name} paddled through the rapids.`, { player: pid });
        return;
      }
      if (p.hand.includes(100)) {
        const use = await g.choose(pid, "You're about to ride the rapids down to the BOAT. Use Paddle Paddle Paddle!?", [
          { id: "yes", label: "Paddle! (+1)" },
          { id: "no", label: "Ride the rapids" },
        ], "Paddle Paddle Paddle!");
        if (use === "yes") {
          g.discardFromHand(p, 100);
          g.log(`${name} paddled back up the stream!`, { player: pid, card: { id: 100, deck: "B" } });
          await g.move(pid, 1);
          return;
        }
      }
      await ctx.harm(pid, (who) => g.moveTo(who, sp.effect!.fail!.teleport), { source: "board", text: "The rapids are carrying you down to the BOAT!" });
      return;
    }
    case "troll-battle": {
      const ok = await ctx.rollFor(pid, [2, 4, 6], "Roll a 2, 4 or 6 to defeat the Troll!");
      if (ok) g.log(`${name} defeated the Troll!`, { player: pid });
      else await ctx.harm(pid, (who) => g.moveTo(who, sp.effect!.fail!.teleport), { source: "board", text: "The Troll is throwing you down to the BOAT!" });
      return;
    }
    case "hippo-bee":
    case "star": {
      const e = sp.effect!;
      const ok = await ctx.rollFor(pid, e.roll!, sp.text);
      if (ok) await g.moveTo(pid, e.success!.teleport);
      return;
    }
    default:
      return;
  }
}

export async function dragonFight(ctx: Ctx, pid: string) {
  const g = ctx.game;
  const p = g.player(pid);
  let chances = 1;
  if (p.hand.includes(102)) {
    const use = await g.choose(pid, "Use Dragon Scales! for 3 chances to defeat the DRAGON?", [
      { id: "yes", label: "Use Dragon Scales!" },
      { id: "no", label: "Fight without it" },
    ], "Dragon Scales!");
    if (use === "yes") {
      g.discardFromHand(p, 102);
      g.log(`${p.name} put on Dragon Scales!`, { player: pid, card: { id: 102, deck: "B" } });
      chances = 3;
    }
  }
  for (let i = 0; i < chances; i++) {
    const ok = await ctx.rollFor(pid, [2, 4, 6], `Roll a 2, 4 or 6 to defeat the DRAGON!${chances > 1 ? ` (chance ${i + 1} of ${chances})` : ""}`);
    if (ok) {
      g.log(`${p.name} defeated the DRAGON!`, { player: pid });
      return;
    }
  }
  const zone = ctx.spacesOfType("dragon-recovery")[0];
  await ctx.harm(pid, (who) => g.moveTo(who, zone), { source: "board", text: "The DRAGON is flame-blasting you back to the Recovery Zone!" });
}

/** Everyone standing on one of `colors` goes back `n` (Safe Zones and the Nebula have no color). */
export async function cannonBlast(ctx: Ctx, colors: Color[], n: number, opts: { hitSelfBonus?: boolean } = {}) {
  const hit = ctx.players().filter((p) => {
    const c = ctx.color(p);
    return c !== null && colors.includes(c);
  });
  if (hit.length === 0) {
    ctx.game.log("The cannonball hit nobody.");
    return;
  }
  for (const p of hit) {
    if (opts.hitSelfBonus && p === ctx.me) {
      await ctx.move(p, n);
      continue;
    }
    await ctx.harm(p, (who) => ctx.move(who, -n).then(() => undefined), { source: "board", text: "A cannonball is flying at you!" });
  }
}

/** Does what a spinner segment says (the "action" use of the spinner). */
export async function doSegment(ctx: Ctx, pid: string, seg: number) {
  const g = ctx.game;
  const s = spinnerSegments[seg];
  switch (s.action) {
    case "bonus-card":
      await ctx.drawBonus(pid, 1);
      return;
    case "nebula":
      await ctx.harm(pid, (who) => ctx.nebula(who, 1), { source: "board" });
      return;
    case "action-card":
      await ctx.drawAction(pid);
      return;
    case "roll-2-dice": {
      const sum = await ctx.rollSum(pid, 2, "Roll 2 dice and go forward that amount.");
      await ctx.move(pid, sum);
      return;
    }
    case "dragon-fight": {
      const dragon = ctx.spacesOfType("dragon-fight")[0];
      await g.moveTo(pid, dragon);
      await dragonFight(ctx, pid);
      return;
    }
    case "duel": {
      const opp = await ctx.pickPlayer(pid, "Pick a player to duel. Winner goes +5, loser goes -1.", ctx.others(pid).filter((o) => !ctx.inNebula(o)));
      if (!opp) return;
      const [w, l] = await ctx.duel(pid, opp);
      await ctx.move(w, 5);
      await ctx.move(l, -1);
      return;
    }
    case "closest-spot": {
      const next = nextColored(ctx, pid);
      if (next) await g.moveTo(pid, next);
      return;
    }
  }
}

function nextColored(ctx: Ctx, pid: string): string | null {
  const p = ctx.player(pid);
  let id: string | null = p.pos.kind === "start" ? ctx.board.first : p.pos.kind === "space" ? p.pos.id : null;
  if (!id) return null;
  if (p.pos.kind === "space") id = forward(ctx, id, p.branch);
  while (id) {
    if (space(ctx.board, id).color) return id;
    id = forward(ctx, id, p.branch);
  }
  return null;
}

function forward(ctx: Ctx, id: string, branch: "bridge" | "lower"): string | null {
  const next = space(ctx.board, id).next.filter((n) => n !== "finish");
  if (next.length === 0) return null;
  return next.find((n) => space(ctx.board, n).path === branch) ?? next[0];
}
