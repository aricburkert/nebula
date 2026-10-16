import cardsData from "../../data/cards.json";
import { BOARDS, type Board, colorAt, nebulaExit, progress, space, spacesOfType, stepBack, typeAt } from "./board";
import { Rng } from "./rng";
import type {
  Answer,
  Color,
  GameState,
  Input,
  LogEntry,
  Option,
  PlayerState,
  Pos,
  Prompt,
  PromptInput,
  Settings,
  Watcher,
} from "./types";
import { CARD_SCRIPTS, BONUS_CARDS, type BonusCard } from "./cards";
import { resolveSpace, spinnerSegments } from "./spaces";

export interface CardInfo {
  id: number;
  deck: "A" | "B";
  title: string | null;
  online: "as-is" | "chat" | "video-call" | "remove";
}

export const CARDS: CardInfo[] = (cardsData as { cards: CardInfo[] }).cards.map((c) => ({
  id: c.id,
  deck: c.deck,
  title: c.title,
  online: c.online,
}));
export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function cardName(id: number): string {
  const c = CARD_BY_ID.get(id);
  return c?.title ?? `${c?.deck === "B" ? "Bonus" : "Action"} card #${id}`;
}

export interface GameConfig {
  seed: number;
  players: { id: string; name: string; pawn: string }[];
  settings: Settings;
  board?: string;
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

/** Things that can trigger while a curse card is in play. */
export interface WatcherDef {
  /** Called after every roll this player makes. Return true to remove the watcher. */
  onRoll?: (dice: number[]) => Promise<boolean | void>;
  /** Who may press "Gotcha" on this player: anyone but them, or only the card's holder. */
  gotcha?: { by: "others" | "holder"; holder?: string; apply: () => void };
  /** Remove after this many of the watched player's turns. */
  turns?: number;
}

interface Waiting {
  prompt: Prompt;
  resolve: (answer: Answer | { timeout: true }) => void;
}

const ROLL_FOREVER_GUARD = 50;

export class Game {
  state: GameState;
  board: Board;
  rng: Rng;
  inputs: Input[] = [];
  private waiting: Waiting | null = null;
  private settledResolve: (() => void) | null = null;
  private promptSeq = 0;
  private logSeq = 0;
  private watcherSeq = 0;
  private watcherDefs = new Map<number, WatcherDef>();
  private movedThisTurn = new Set<string>();
  /** Space each player last had resolved since they last moved, so a space never resolves twice in a row. */
  private resolvedAt = new Map<string, string>();
  private loopPromise: Promise<void> | null = null;
  /** Set when an engine error escaped a card; surfaced in the log. */
  errors: string[] = [];

  constructor(public config: GameConfig) {
    this.board = BOARDS[config.board ?? "standard"];
    this.rng = new Rng(config.seed);
    const usable = (c: CardInfo) => c.online !== "remove" && (c.online !== "video-call" || config.settings.videoCall);
    const players: PlayerState[] = config.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      pawn: p.pawn,
      seat: i,
      pos: { kind: "start" },
      hand: [],
      kept: [],
      nebulaTurns: 0,
      skipTurns: 0,
      branch: "bridge",
      flags: {},
      connected: true,
    }));
    this.state = {
      phase: "playing",
      board: this.board.name,
      players,
      turn: 0,
      round: 1,
      current: players[0].id,
      actionDeck: this.rng.shuffle(CARDS.filter((c) => c.deck === "A" && usable(c)).map((c) => c.id)),
      actionDiscard: [],
      bonusDeck: this.rng.shuffle(CARDS.filter((c) => c.deck === "B" && usable(c)).map((c) => c.id)),
      bonusDiscard: [],
      traps: [],
      watchers: [],
      active: null,
      lastRoll: null,
      lastSpin: null,
      pending: null,
      log: [],
      winner: null,
      settings: config.settings,
    };
  }

  // ---------------------------------------------------------------- running

  /** Starts the game and resolves once the engine is waiting for its first input. */
  start(): Promise<void> {
    const settled = this.nextSettle();
    this.loopPromise = this.loop();
    return settled;
  }

  /** Rebuilds a game from its config and input log. */
  static async replay(config: GameConfig, inputs: Input[]): Promise<Game> {
    const g = new Game(config);
    await g.start();
    for (const input of inputs) {
      const r = await g.submit(input);
      if (!r.ok) throw new Error(`Replay diverged at input ${JSON.stringify(input)}: ${r.error}`);
    }
    return g;
  }

  private nextSettle(): Promise<void> {
    return new Promise((r) => (this.settledResolve = r));
  }

  private settle() {
    const r = this.settledResolve;
    this.settledResolve = null;
    r?.();
  }

  async submit(input: Input): Promise<SubmitResult> {
    if (this.state.phase === "over") return { ok: false, error: "The game is over." };
    if ("interrupt" in input) {
      const err = this.applyInterrupt(input);
      if (err) return { ok: false, error: err };
      this.inputs.push(input);
      return { ok: true };
    }
    const w = this.waiting;
    if (!w || w.prompt.id !== input.promptId) return { ok: false, error: "That prompt is no longer active." };
    let complete: Answer | { timeout: true } | null;
    if ("timeout" in input) {
      complete = { timeout: true };
    } else {
      const res = this.accept(w.prompt, input.player, input.answer);
      if (typeof res === "string") return { ok: false, error: res };
      complete = res;
    }
    this.inputs.push(input);
    if (complete === null) return { ok: true }; // multi-player prompt still collecting
    this.waiting = null;
    this.state.pending = null;
    const settled = this.nextSettle();
    w.resolve(complete);
    await settled;
    return { ok: true };
  }

  /**
   * Validates an answer. Returns an error string, null if a multi-player prompt
   * is still collecting, or the final answer.
   */
  private accept(p: Prompt, player: string, a: Answer): string | Answer | null {
    const is = (k: string) => k in a;
    switch (p.kind) {
      case "turn":
        if (player !== p.player) return "Not your turn.";
        if (is("action") && (a as { action: string }).action === "draw") return a;
        if (is("action") && (a as { action: string }).action === "play") {
          const card = (a as { card: number }).card;
          return p.playable.includes(card) ? a : "You can't play that card now.";
        }
        return "Choose to draw or play a card.";
      case "choose":
        if (player !== p.player) return "Not your choice.";
        return is("choice") && p.options.some((o) => o.id === (a as { choice: string }).choice) ? a : "Pick one of the options.";
      case "roll":
      case "spin":
        return player === p.player ? a : "Not your roll.";
      case "timer":
        return a;
      case "pickPlayer":
        if (player !== p.player) return "Not your choice.";
        return is("target") && p.candidates.includes((a as { target: string }).target) ? a : "Pick one of the players.";
      case "pickSpace":
        if (player !== p.player) return "Not your choice.";
        return is("space") && p.candidates.includes((a as { space: string }).space) ? a : "Pick one of the spaces.";
      case "react":
        if (player !== p.player) return "Not your choice.";
        if (!is("card")) return "Choose a card or pass.";
        {
          const c = (a as { card: number | null }).card;
          return c === null || p.cards.includes(c) ? a : "You can't play that card.";
        }
      case "text":
        if (player !== p.player) return "Not your turn to write.";
        if (!is("text")) return "Type something.";
        return { text: String((a as { text: string }).text).slice(0, p.maxLength) };
      case "vote": {
        if (!p.voters.includes(player)) return "You don't get a vote on this one.";
        if (!is("choice") || !p.options.some((o) => o.id === (a as { choice: string }).choice)) return "Pick one of the options.";
        p.votes[player] = (a as { choice: string }).choice;
        return p.voters.every((v) => p.votes[v] !== undefined) ? a : null;
      }
      case "race": {
        if (!p.players.includes(player)) return "You're not in this race.";
        if (p.wrong.includes(player)) return "You already guessed wrong.";
        if (!is("answer")) return "Type a number.";
        const n = Number((a as { answer: number }).answer);
        const sum = p.dice.reduce((x, y) => x + y, 0);
        if (n === sum) return { choice: player };
        p.wrong.push(player);
        return p.players.every((x) => p.wrong.includes(x)) ? { choice: "" } : null;
      }
    }
  }

  private async loop() {
    try {
      this.pickFirstPlayer();
      while (this.state.phase === "playing") {
        const p = this.player(this.state.current);
        this.movedThisTurn.clear();
        try {
          await this.takeTurn(p);
        } catch (e) {
          if (e instanceof GameOver) break;
          this.errors.push(String((e as Error).stack ?? e));
          this.log(`Something went wrong resolving that card; skipping it.`);
        }
        if (this.state.winner) break;
        this.tickWatchers(p.id);
        this.advanceTurn();
      }
    } catch (e) {
      if (!(e instanceof GameOver)) this.errors.push(String((e as Error).stack ?? e));
    }
    this.state.phase = "over";
    this.state.pending = null;
    this.settle();
  }

  private pickFirstPlayer() {
    const rolls = this.state.players.map((p) => ({ p, r: this.rng.die() }));
    for (const { p, r } of rolls) this.log(`${p.name} rolled a ${r} to see who goes first.`, { player: p.id, dice: [r] });
    const best = rolls.reduce((a, b) => (b.r > a.r ? b : a));
    this.state.turn = best.p.seat;
    this.state.current = best.p.id;
    this.log(`${best.p.name} goes first!`);
  }

  private advanceTurn() {
    const n = this.state.players.length;
    const next = (this.state.turn + 1) % n;
    if (next <= this.state.turn) this.state.round++;
    this.state.turn = next;
    this.state.current = this.state.players[next].id;
  }

  private async takeTurn(p: PlayerState) {
    this.state.active = null;
    if (p.pos.kind === "nebula") {
      if (p.hand.includes(101)) {
        const use = await this.choose(p.id, "You're stuck in the NEBULA. Use your Freedom! card?", [
          { id: "yes", label: "Use Freedom!" },
          { id: "no", label: "Stay put" },
        ], "Freedom!");
        if (use === "yes") {
          this.discardFromHand(p, 101);
          this.leaveNebula(p);
          this.log(`${p.name} used Freedom! and escaped the NEBULA.`, { player: p.id, card: { id: 101, deck: "B" } });
          await this.nebulaExitBonus(p);
        }
      }
      if ((p.pos as Pos).kind === "nebula") {
        p.nebulaTurns = Math.max(0, p.nebulaTurns - 1);
        if (p.nebulaTurns === 0) {
          this.leaveNebula(p);
          this.log(`${p.name} drifts in the NEBULA for a turn, then crawls out.`, { player: p.id });
          await this.nebulaExitBonus(p);
        } else {
          this.log(`${p.name} is still stuck in the NEBULA (${p.nebulaTurns} more).`, { player: p.id });
        }
        return;
      }
    }
    if (p.skipTurns > 0) {
      p.skipTurns--;
      this.log(`${p.name} skips this turn.`, { player: p.id });
      return;
    }

    const onHook = typeAt(this.board, p.pos) === "grappling-hook";
    // Turn menu: play any number of Bonus cards, then draw (or roll for the win on the hook).
    for (let guard = 0; guard < 20; guard++) {
      const playable = this.playableBonus(p);
      const a = (await this.ask({
        kind: "turn",
        player: p.id,
        playable,
        title: onHook ? "Grappling Hook" : "Your turn",
        text: onHook ? "Roll a 1 to win! (No Action card while you're on the hook.)" : "Draw an Action card, or play a Bonus card first.",
      })) as { action: "draw" } | { action: "play"; card: number };
      if (a.action === "play") {
        await this.playBonus(p, a.card);
        if (this.state.winner) return;
        if ((p.pos as Pos).kind === "nebula" || (typeAt(this.board, p.pos) === "grappling-hook") !== onHook) break;
        continue;
      }
      break;
    }
    if ((p.pos as Pos).kind === "nebula" || this.state.winner) return;

    if (typeAt(this.board, p.pos) === "grappling-hook") {
      const [d] = await this.roll(p.id, 1, "Roll a 1 to escape the Grappling Hook and win!", "Grappling Hook");
      if (d === 1) this.win(p.id);
      else this.log(`${p.name} rolled a ${d}. Still hooked.`, { player: p.id });
      return;
    }

    await this.drawAction(p.id);
    if (this.state.winner) return;
    if (this.movedThisTurn.has(p.id) && p.pos.kind === "space" && this.resolvedAt.get(p.id) !== p.pos.id) {
      await resolveSpace(this.ctx(p.id, 0), p.id);
    }
  }

  async drawAction(pid: string) {
    const card = this.drawFrom("A");
    if (card === undefined) {
      this.log("The Action deck is empty.");
      return;
    }
    const p = this.player(pid);
    this.state.active = { card, deck: "A", player: pid };
    this.log(`${p.name} drew ${cardName(card)}.`, { player: pid, card: { id: card, deck: "A" } });
    const script = CARD_SCRIPTS[card];
    let keep = false;
    if (script) {
      keep = (await script(this.ctx(pid, card))) === "keep";
    } else {
      this.log(`(Card #${card} isn't scripted yet.)`);
    }
    if (keep) p.kept.push(card);
    else this.state.actionDiscard.push(card);
  }

  private playableBonus(p: PlayerState): number[] {
    return p.hand.filter((c) => {
      const def = BONUS_CARDS[c];
      if (!def || def.when !== "turn") return false;
      return def.canPlay ? def.canPlay(this.ctx(p.id, c)) : true;
    });
  }

  async playBonus(p: PlayerState, card: number) {
    const def = BONUS_CARDS[card];
    this.discardFromHand(p, card);
    this.state.active = { card, deck: "B", player: p.id };
    this.log(`${p.name} played ${cardName(card)}!`, { player: p.id, card: { id: card, deck: "B" } });
    const keep = def ? (await def.play(this.ctx(p.id, card))) === "keep" : false;
    if (keep) p.hand.push(card);
  }

  // ---------------------------------------------------------------- prompts

  ask(prompt: PromptInput): Promise<Answer | { timeout: true }> {
    const full = { ...prompt, id: ++this.promptSeq } as Prompt;
    this.state.pending = full;
    return new Promise((resolve) => {
      this.waiting = { prompt: full, resolve };
      this.settle();
    });
  }

  async choose(pid: string, text: string, options: Option[], title?: string): Promise<string> {
    if (options.length === 1) return options[0].id;
    const a = await this.ask({ kind: "choose", player: pid, text, options, title });
    if ("timeout" in a) return options[0].id;
    return (a as { choice: string }).choice;
  }

  async roll(pid: string, dice = 1, text?: string, title?: string): Promise<number[]> {
    const p = this.player(pid);
    await this.ask({ kind: "roll", player: pid, dice, text: text ?? `Roll ${dice === 1 ? "the die" : `${dice} dice`}.`, title });
    let result = Array.from({ length: dice }, () => this.rng.die());
    if (p.flags.doubleNextRoll) {
      delete p.flags.doubleNextRoll;
      result = result.map((d) => d * 2);
      this.log(`Double Double! ${p.name}'s roll is doubled.`, { player: pid });
    }
    if (typeof p.flags.rollBonus === "number") {
      const bonus = p.flags.rollBonus;
      delete p.flags.rollBonus;
      result = [...result.slice(0, -1), result[result.length - 1] + bonus];
      this.log(`${p.name} adds +${bonus} to this roll.`, { player: pid });
    }
    this.state.lastRoll = { player: pid, dice: result };
    this.log(`${p.name} rolled ${result.join(" + ")}${dice > 1 ? ` = ${result.reduce((a, b) => a + b, 0)}` : ""}.`, {
      player: pid,
      dice: result,
    });
    for (const w of this.state.watchers.filter((w) => w.player === pid)) {
      const def = this.watcherDefs.get(w.id);
      if (def?.onRoll && this.state.watchers.includes(w)) {
        const done = await def.onRoll(result);
        if (done) this.unwatch(w.id);
      }
    }
    return result;
  }

  async spin(pid: string, mode: "action" | "color", text?: string, title?: string): Promise<number> {
    await this.ask({
      kind: "spin",
      player: pid,
      mode,
      text: text ?? (mode === "color" ? "Spin! Only the color counts." : "Spin the spinner!"),
      title,
    });
    const seg = this.rng.int(spinnerSegments.length);
    this.state.lastSpin = { player: pid, segment: seg };
    const s = spinnerSegments[seg];
    const colors = Array.isArray(s.color) ? s.color.join(", ") : s.color;
    this.log(`${this.player(pid).name} spun: ${mode === "color" ? colors.toUpperCase() : s.text}.`, { player: pid, spin: seg });
    return seg;
  }

  async pickPlayer(pid: string, text: string, candidates: string[], title?: string): Promise<string | null> {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const a = await this.ask({ kind: "pickPlayer", player: pid, text, candidates, title });
    if ("timeout" in a) return candidates[0];
    return (a as { target: string }).target;
  }

  async pickSpace(pid: string, text: string, candidates: string[], title?: string): Promise<string> {
    const a = await this.ask({ kind: "pickSpace", player: pid, text, candidates, title });
    if ("timeout" in a) return candidates[0];
    return (a as { space: string }).space;
  }

  async vote(voters: string[], text: string, options: Option[], title?: string): Promise<Record<string, string>> {
    if (voters.length === 0) return {};
    const votes: Record<string, string> = {};
    await this.ask({ kind: "vote", voters, text, options, votes, title });
    return votes;
  }

  async timer(pid: string, seconds: number, text: string, title?: string): Promise<void> {
    await this.ask({ kind: "timer", player: pid, seconds, text, title });
  }

  async askText(pid: string, text: string, title?: string): Promise<string> {
    const a = await this.ask({ kind: "text", player: pid, text, maxLength: 200, title });
    return "text" in a ? a.text : "";
  }

  async race(players: string[], dice: number[], text: string, title?: string): Promise<{ winner: string | null; wrong: string[] }> {
    const wrong: string[] = [];
    const a = await this.ask({ kind: "race", players, dice, wrong, text, title });
    const winner = "choice" in a && a.choice ? a.choice : null;
    return { winner, wrong };
  }

  // ---------------------------------------------------------------- state helpers

  player(id: string): PlayerState {
    const p = this.state.players.find((p) => p.id === id);
    if (!p) throw new Error(`Unknown player ${id}`);
    return p;
  }

  log(text: string, extra: Partial<LogEntry> = {}) {
    this.state.log.push({ n: ++this.logSeq, text, ...extra });
    if (this.state.log.length > 300) this.state.log.splice(0, this.state.log.length - 300);
  }

  drawFrom(deck: "A" | "B"): number | undefined {
    const [d, discard] = deck === "A" ? (["actionDeck", "actionDiscard"] as const) : (["bonusDeck", "bonusDiscard"] as const);
    if (this.state[d].length === 0 && this.state[discard].length > 0) {
      this.state[d] = this.rng.shuffle(this.state[discard]);
      this.state[discard] = [];
      this.log(`The ${deck === "A" ? "Action" : "Bonus"} deck was reshuffled.`);
    }
    return this.state[d].shift();
  }

  discardFromHand(p: PlayerState, card: number) {
    const i = p.hand.indexOf(card);
    if (i >= 0) p.hand.splice(i, 1);
    this.state.bonusDiscard.push(card);
  }

  colorOf(pid: string): Color | null {
    return colorAt(this.board, this.player(pid).pos);
  }

  isSafe(pid: string): boolean {
    return typeAt(this.board, this.player(pid).pos) === "safe";
  }

  progressOf(pid: string): number {
    return progress(this.board, this.player(pid).pos);
  }

  /** Puts a pawn somewhere and fires traps. Does not resolve the space. */
  async place(pid: string, pos: Pos, opts: { silent?: boolean } = {}) {
    const p = this.player(pid);
    p.pos = pos;
    this.resolvedAt.delete(pid);
    if (pos.kind === "space") {
      const sp = space(this.board, pos.id);
      if (sp.path) p.branch = sp.path;
    }
    this.movedThisTurn.add(pid);
    if (!opts.silent && pos.kind === "space") await this.checkTraps(pid);
  }

  private async checkTraps(pid: string) {
    const p = this.player(pid);
    if (p.pos.kind !== "space") return;
    const id = p.pos.id;
    for (const trap of this.state.traps.filter((t) => t.space === id && t.owner !== pid)) {
      const def = BONUS_CARDS[trap.card];
      this.log(`${p.name} landed on ${this.player(trap.owner).name}'s ${cardName(trap.card)}!`, {
        player: pid,
        card: { id: trap.card, deck: "B" },
      });
      if (def?.onTrap) await def.onTrap(this.ctx(trap.owner, trap.card), pid);
      if (p.pos.kind !== "space" || p.pos.id !== id) break;
    }
  }

  markResolved(pid: string, spaceId: string) {
    this.resolvedAt.set(pid, spaceId);
  }

  sendToNebula(pid: string, turns: number) {
    const p = this.player(pid);
    p.pos = { kind: "nebula" };
    p.nebulaTurns = Math.max(p.nebulaTurns, turns);
    this.movedThisTurn.add(pid);
    this.log(`${p.name} got sucked into the NEBULA for ${turns} turn${turns === 1 ? "" : "s"}!`, { player: pid });
  }

  /** Card 71 lets a player go +5 when they get out of the NEBULA. */
  private async nebulaExitBonus(p: PlayerState) {
    const bonus = p.flags.nebulaExitBonus;
    if (typeof bonus !== "number") return;
    delete p.flags.nebulaExitBonus;
    await this.move(p.id, bonus);
  }

  leaveNebula(p: PlayerState) {
    p.nebulaTurns = 0;
    p.pos = { kind: "space", id: nebulaExit(this.board) };
    p.branch = "lower";
  }

  /**
   * Walks a pawn n spaces (negative = backwards). Stops on the Grappling Hook
   * going forward and on START going back. Asks the mover at the fork.
   * Returns the spaces passed through, ending with the landing space.
   */
  async move(pid: string, n: number, opts: { fireTraps?: boolean } = {}): Promise<string[]> {
    const p = this.player(pid);
    if (p.pos.kind === "nebula" || p.pos.kind === "finish" || n === 0) return [];
    const path: string[] = [];
    let pos: Pos = p.pos;
    const steps = Math.abs(n);
    for (let i = 0; i < steps; i++) {
      if (n > 0) {
        if (pos.kind === "start") pos = { kind: "space", id: this.board.first };
        else if (pos.kind === "space") {
          const sp = space(this.board, pos.id);
          if (sp.type === "grappling-hook") break;
          let next = sp.next[0];
          if (sp.next.length > 1) {
            const choice = await this.choose(
              pid,
              "Which way? The bridge (Troll Battle) or the lower path (Boat, Nebula)?",
              sp.next.map((id) => ({ id, label: space(this.board, id).path === "lower" ? "↓ Lower path" : "→ Bridge path" })),
              "Fork in the path",
            );
            next = choice;
          }
          pos = { kind: "space", id: next };
        }
      } else {
        if (pos.kind !== "space") break;
        const back = stepBack(this.board, pos.id, p.branch);
        pos = back === "start" ? { kind: "start" } : { kind: "space", id: back };
      }
      if (pos.kind === "space") {
        path.push(pos.id);
        const sp = space(this.board, pos.id);
        if (sp.path) p.branch = sp.path;
      }
      if (pos.kind === "start") break;
    }
    await this.place(pid, pos, { silent: opts.fireTraps === false });
    const where = pos.kind === "start" ? "START" : pos.kind === "space" ? describeSpace(this.board, pos.id) : "somewhere";
    this.log(`${p.name} moved ${n > 0 ? "+" : ""}${n} to ${where}.`, { player: pid });
    return path;
  }

  async moveTo(pid: string, target: string) {
    const p = this.player(pid);
    if (target === "nebula") return this.sendToNebula(pid, 1);
    if (target === "start") {
      p.nebulaTurns = 0;
      await this.place(pid, { kind: "start" });
      this.log(`${p.name} went back to START.`, { player: pid });
      return;
    }
    p.nebulaTurns = 0;
    await this.place(pid, { kind: "space", id: target });
    this.log(`${p.name} went to ${describeSpace(this.board, target)}.`, { player: pid });
  }

  win(pid: string) {
    const p = this.player(pid);
    p.pos = { kind: "finish" };
    this.state.winner = pid;
    this.log(`🎉 ${p.name} reached FINISH and wins The Nebula from Hell!`, { player: pid });
    throw new GameOver();
  }

  drawBonus(pid: string, n = 1): Promise<number[]> {
    return this.drawBonusInner(pid, n);
  }

  private async drawBonusInner(pid: string, n: number): Promise<number[]> {
    const got: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.drawFrom("B");
      if (c === undefined) {
        this.log("The Bonus deck is empty.");
        break;
      }
      // Backstab!: another player may snatch it.
      const thieves = this.state.players.filter((q) => q.id !== pid && q.hand.includes(95));
      let taken = false;
      for (const t of thieves) {
        const a = await this.ask({
          kind: "react",
          player: t.id,
          cards: [95],
          title: "Backstab!",
          text: `${this.player(pid).name} is collecting a Bonus card. Backstab them and take it?`,
        });
        if ("card" in a && a.card === 95) {
          this.discardFromHand(t, 95);
          t.hand.push(c);
          this.log(`${t.name} Backstabbed ${this.player(pid).name} and took their Bonus card!`, {
            player: t.id,
            card: { id: 95, deck: "B" },
          });
          taken = true;
          break;
        }
      }
      if (!taken) {
        this.player(pid).hand.push(c);
        got.push(c);
      }
    }
    if (got.length) this.log(`${this.player(pid).name} collected ${got.length === 1 ? "a Bonus card" : `${got.length} Bonus cards`}.`, { player: pid });
    return got;
  }

  // ---------------------------------------------------------------- watchers (kept curse cards)

  watch(pid: string, card: number, label: string, def: WatcherDef): number {
    const id = ++this.watcherSeq;
    this.state.watchers.push({ id, player: pid, card, label });
    this.watcherDefs.set(id, def);
    return id;
  }

  unwatch(id: number) {
    const w = this.state.watchers.find((w) => w.id === id);
    this.state.watchers = this.state.watchers.filter((w) => w.id !== id);
    this.watcherDefs.delete(id);
    if (w) {
      const p = this.player(w.player);
      const i = p.kept.indexOf(w.card);
      if (i >= 0) {
        p.kept.splice(i, 1);
        (CARD_BY_ID.get(w.card)?.deck === "A" ? this.state.actionDiscard : this.state.bonusDiscard).push(w.card);
      }
    }
  }

  private tickWatchers(pid: string) {
    for (const w of [...this.state.watchers]) {
      const def = this.watcherDefs.get(w.id);
      if (w.player === pid && def?.turns !== undefined) {
        def.turns--;
        if (def.turns <= 0) this.unwatch(w.id);
      }
    }
  }

  private applyInterrupt(input: Extract<Input, { interrupt: "gotcha" }>): string | null {
    const by = this.state.players.find((p) => p.id === input.player);
    const target = this.state.players.find((p) => p.id === input.target);
    if (!by || !target) return "Unknown player.";
    if (by.id === target.id) return "You can't catch yourself.";
    // My Turn! Your Turn! (card 99) is a Bonus card in hand.
    if (input.card === 99) {
      if (!by.hand.includes(99)) return "You don't have My Turn! Your Turn!";
      this.discardFromHand(by, 99);
      target.pos = { kind: "start" };
      target.nebulaTurns = 0;
      this.log(`${by.name} caught ${target.name} saying "${input.reason}"! Back to START.`, {
        player: by.id,
        card: { id: 99, deck: "B" },
      });
      return null;
    }
    const w = this.state.watchers.find((w) => w.player === target.id && w.card === input.card);
    const def = w && this.watcherDefs.get(w.id);
    if (!w || !def?.gotcha) return "Nothing to catch them on right now.";
    if (def.gotcha.by === "holder" && def.gotcha.holder !== by.id) return "Only the card's owner can call that.";
    this.log(`${by.name} caught ${target.name}: ${input.reason}`, { player: by.id, card: { id: input.card, deck: CARD_BY_ID.get(input.card)!.deck } });
    def.gotcha.apply();
    this.unwatch(w.id);
    return null;
  }

  // ---------------------------------------------------------------- views

  /** What one player is allowed to see. Other players' hands are hidden. */
  view(viewer: string | null) {
    const s = this.state;
    const pending = s.pending && s.pending.kind === "react" && s.pending.player !== viewer ? { ...s.pending, cards: [] } : s.pending;
    return {
      ...s,
      actionDeck: s.actionDeck.length,
      bonusDeck: s.bonusDeck.length,
      actionDiscard: s.actionDiscard.slice(-1),
      bonusDiscard: s.bonusDiscard.slice(-1),
      pending,
      players: s.players.map((p) => ({ ...p, hand: p.id === viewer ? p.hand : p.hand.map(() => 0) })),
    };
  }

  ctx(pid: string, card: number) {
    return new Ctx(this, pid, card);
  }

  /** Lets tests wait for the background loop to finish. */
  finished(): Promise<void> {
    return this.loopPromise ?? Promise.resolve();
  }
}

export type GameView = ReturnType<Game["view"]>;

export class GameOver extends Error {}

export function describeSpace(board: Board, id: string): string {
  const s = space(board, id);
  const names: Record<string, string> = {
    bonus: "a Bonus card space",
    spinner: "a Spin the Spinner space",
    safe: "a Safe Zone",
    "hippo-bee": "the Hippo Bee",
    "troll-fight": "Troll Fight!",
    fork: "the fork",
    "troll-battle": "the Troll Battle",
    star: "a Star",
    boat: "the BOAT",
    nebula: "the NEBULA space",
    "dragon-recovery": "the Dragon Battle Recovery Zone",
    canoe: "the CANOE",
    "dragon-fight": "the DRAGON",
    cannon: "the CANNON",
    "grappling-hook": "the Grappling Hook",
  };
  return names[s.type] ?? s.type;
}

/**
 * The API card and space scripts use. `me` is the player resolving the card.
 * Everything here goes through the Game so it stays deterministic and logged.
 */
export class Ctx {
  constructor(
    public game: Game,
    public me: string,
    public card: number,
  ) {}

  get board() {
    return this.game.board;
  }
  get state() {
    return this.game.state;
  }
  name(pid: string) {
    return this.game.player(pid).name;
  }
  player(pid: string) {
    return this.game.player(pid);
  }
  /** All players in seat order. */
  players(): string[] {
    return this.game.state.players.map((p) => p.id);
  }
  others(pid = this.me): string[] {
    return this.players().filter((p) => p !== pid);
  }
  /** Players on the board (not in the NEBULA, not finished). */
  onBoard(): string[] {
    return this.players().filter((p) => {
      const k = this.game.player(p).pos.kind;
      return k === "space" || k === "start";
    });
  }
  inNebula(pid: string) {
    return this.game.player(pid).pos.kind === "nebula";
  }
  color(pid: string) {
    return this.game.colorOf(pid);
  }
  isSafe(pid: string) {
    return this.game.isSafe(pid);
  }
  spaceType(pid: string) {
    return typeAt(this.board, this.game.player(pid).pos);
  }
  spaceId(pid: string): string | null {
    const pos = this.game.player(pid).pos;
    return pos.kind === "space" ? pos.id : null;
  }
  progress(pid: string) {
    return this.game.progressOf(pid);
  }
  /** Player to the left plays next (seat + 1). */
  leftOf(pid = this.me) {
    const ps = this.game.state.players;
    const i = this.game.player(pid).seat;
    return ps[(i + 1) % ps.length].id;
  }
  rightOf(pid = this.me) {
    const ps = this.game.state.players;
    const i = this.game.player(pid).seat;
    return ps[(i - 1 + ps.length) % ps.length].id;
  }
  /** The other player nearest on the track (ties: first in seat order). */
  closestPlayer(pid = this.me): string | null {
    const mine = this.progress(pid);
    let best: string | null = null;
    let bestD = Infinity;
    for (const o of this.others(pid)) {
      if (this.inNebula(o)) continue;
      const d = Math.abs(this.progress(o) - mine);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }
  hand(pid: string) {
    return this.game.player(pid).hand;
  }
  log(text: string) {
    this.game.log(text, { player: this.me });
  }

  // prompts
  roll(pid = this.me, dice = 1, text?: string) {
    return this.game.roll(pid, dice, text, this.title());
  }
  async rollSum(pid = this.me, dice = 1, text?: string) {
    return (await this.roll(pid, dice, text)).reduce((a, b) => a + b, 0);
  }
  /** Rolls one die; true if it shows one of `wins`. */
  async rollFor(pid: string, wins: number[], text?: string) {
    const [d] = await this.roll(pid, 1, text ?? `Roll ${listOr(wins)}!`);
    return wins.includes(d);
  }
  spin(pid = this.me, mode: "action" | "color" = "action", text?: string) {
    return this.game.spin(pid, mode, text, this.title());
  }
  /** Spins for color. Returns the colors hit (the "closest spot" segment hits all three). */
  async spinColor(pid = this.me, text?: string): Promise<Color[]> {
    const seg = await this.spin(pid, "color", text);
    const c = spinnerSegments[seg].color;
    return (Array.isArray(c) ? c : [c]) as Color[];
  }
  choose(pid: string, text: string, options: [string, string][] | Option[]) {
    const opts = options.map((o) => (Array.isArray(o) ? { id: o[0], label: o[1] } : o));
    return this.game.choose(pid, text, opts, this.title());
  }
  pickPlayer(pid: string, text: string, candidates = this.others(pid)) {
    return this.game.pickPlayer(pid, text, candidates, this.title());
  }
  pickSpace(pid: string, text: string, candidates: string[]) {
    return this.game.pickSpace(pid, text, candidates, this.title());
  }
  vote(voters: string[], text: string, options: [string, string][] | Option[]) {
    const opts = options.map((o) => (Array.isArray(o) ? { id: o[0], label: o[1] } : o));
    return this.game.vote(voters, text, opts, this.title());
  }
  /** Runs a vote and returns the option with the most votes (ties go to the first listed option among the tied). */
  async majority(voters: string[], text: string, options: [string, string][]): Promise<string | null> {
    const votes = await this.vote(voters, text, options);
    const counts = new Map<string, number>();
    for (const v of Object.values(votes)) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: string | null = null;
    let n = 0;
    for (const [id] of options) {
      const c = counts.get(id) ?? 0;
      if (c > n) {
        n = c;
        best = id;
      }
    }
    return best;
  }
  timer(pid: string, seconds: number, text: string) {
    return this.game.timer(pid, seconds, text, this.title());
  }
  askText(pid: string, text: string) {
    return this.game.askText(pid, text, this.title());
  }
  race(players: string[], dice: number[], text: string) {
    return this.game.race(players, dice, text, this.title());
  }

  // movement and effects
  move(pid: string, n: number) {
    return this.game.move(pid, n);
  }
  moveTo(pid: string, target: string) {
    return this.game.moveTo(pid, target);
  }
  nebula(pid: string, turns = 1) {
    this.game.sendToNebula(pid, turns);
  }
  toStart(pid: string) {
    return this.game.moveTo(pid, "start");
  }
  skip(pid: string, turns = 1) {
    const p = this.game.player(pid);
    p.skipTurns += turns;
    this.game.log(`${p.name} will skip ${turns} turn${turns === 1 ? "" : "s"}.`, { player: pid });
  }
  /** Resolves the space the player is standing on (Dragon fight, Troll battle, ...). */
  resolveSpace(pid = this.me) {
    return resolveSpace(this, pid);
  }
  drawBonus(pid = this.me, n = 1) {
    return this.game.drawBonus(pid, n);
  }
  /** Another Action card for the same player, resolved now. */
  drawAction(pid = this.me) {
    return this.game.drawAction(pid);
  }
  /** Removes up to n random Bonus cards (or all). They go to the discard pile, or the bottom of the deck. */
  loseBonus(pid: string, n: number | "all", where: "discard" | "deckBottom" = "discard"): number[] {
    const p = this.game.player(pid);
    const count = n === "all" ? p.hand.length : Math.min(n, p.hand.length);
    const lost: number[] = [];
    for (let i = 0; i < count; i++) {
      const idx = this.game.rng.int(p.hand.length);
      lost.push(p.hand.splice(idx, 1)[0]);
    }
    if (where === "deckBottom") this.game.state.bonusDeck.push(...lost);
    else this.game.state.bonusDiscard.push(...lost);
    if (lost.length) this.game.log(`${p.name} lost ${lost.length} Bonus card${lost.length === 1 ? "" : "s"}.`, { player: pid });
    return lost;
  }
  /** Moves up to n random Bonus cards (or all) from one hand to another. */
  takeBonus(from: string, to: string, n: number | "all" = 1): number[] {
    const a = this.game.player(from);
    const b = this.game.player(to);
    const count = n === "all" ? a.hand.length : Math.min(n, a.hand.length);
    const moved: number[] = [];
    for (let i = 0; i < count; i++) moved.push(a.hand.splice(this.game.rng.int(a.hand.length), 1)[0]);
    b.hand.push(...moved);
    if (moved.length) this.game.log(`${b.name} took ${moved.length} Bonus card${moved.length === 1 ? "" : "s"} from ${a.name}.`, { player: to });
    else this.game.log(`${a.name} had no Bonus cards to take.`, { player: from });
    return moved;
  }
  async swapPlaces(a: string, b: string) {
    const pa = this.game.player(a);
    const pb = this.game.player(b);
    const posA = pa.pos;
    const posB = pb.pos;
    const [na, nb] = [pa.nebulaTurns, pb.nebulaTurns];
    pa.nebulaTurns = nb;
    pb.nebulaTurns = na;
    await this.game.place(a, posB, { silent: true });
    await this.game.place(b, posA, { silent: true });
    this.game.log(`${pa.name} and ${pb.name} swapped places.`, { player: a });
  }
  setFlag(pid: string, key: string, value: number | boolean | string) {
    this.game.player(pid).flags[key] = value;
  }
  /** Both players roll one die until someone wins. Returns [winner, loser]. */
  async duel(a: string, b: string): Promise<[string, string]> {
    for (let i = 0; i < ROLL_FOREVER_GUARD; i++) {
      const [ra] = await this.roll(a, 1, `Duel against ${this.name(b)}: roll!`);
      const [rb] = await this.roll(b, 1, `Duel against ${this.name(a)}: roll!`);
      if (ra !== rb) {
        const res: [string, string] = ra > rb ? [a, b] : [b, a];
        this.game.log(`${this.name(res[0])} wins the duel!`, { player: res[0] });
        return res;
      }
      this.game.log("A tie! Roll again.");
    }
    return [a, b];
  }
  win(pid: string) {
    this.game.win(pid);
  }
  /** Nearest space of a type strictly ahead of the player (following their branch at the fork), or null. */
  nextSpaceOfType(pid: string, type: string): string | null {
    const p = this.game.player(pid);
    let id: string | null = p.pos.kind === "start" ? this.board.first : p.pos.kind === "space" ? p.pos.id : null;
    if (!id) return null;
    if (p.pos.kind === "space") id = this.stepForward(id, p.branch);
    while (id) {
      if (space(this.board, id).type === type) return id;
      id = this.stepForward(id, p.branch);
    }
    return null;
  }
  /** Nearest space of a type behind the player, or null. */
  prevSpaceOfType(pid: string, type: string): string | null {
    const p = this.game.player(pid);
    if (p.pos.kind !== "space") return null;
    let id: string | "start" = stepBack(this.board, p.pos.id, p.branch);
    while (id !== "start") {
      if (space(this.board, id).type === type) return id;
      id = stepBack(this.board, id, p.branch);
    }
    return null;
  }
  private stepForward(id: string, branch: "bridge" | "lower"): string | null {
    const sp = space(this.board, id);
    const next = sp.next.filter((n) => n !== "finish");
    if (next.length === 0) return null;
    if (next.length === 1) return next[0];
    return next.find((n) => space(this.board, n).path === branch) ?? next[0];
  }
  spacesOfType(type: string) {
    return spacesOfType(this.board, type);
  }
  allSpaces(): string[] {
    return this.board.spaces.map((s) => s.id);
  }
  watch(pid: string, label: string, def: WatcherDef) {
    return this.game.watch(pid, this.card, label, def);
  }
  addTrap(spaceId: string) {
    this.game.state.traps.push({ space: spaceId, card: this.card, owner: this.me });
    this.game.log(`${this.name(this.me)} set ${cardName(this.card)} on ${describeSpace(this.board, spaceId)}.`, { player: this.me });
  }

  /**
   * Applies a harmful effect to `target`, first letting them answer it with
   * Shield! (85), Canceled! (92, card effects only) or Reverse Reverse! (107,
   * only when another player caused it). `apply` receives the player who
   * actually suffers it.
   */
  async harm(target: string, apply: (who: string) => Promise<void> | void, opts: { source?: "card" | "board"; text?: string } = {}) {
    const source = opts.source ?? "card";
    const t = this.game.player(target);
    const usable = t.hand.filter(
      (c) => c === 85 || (c === 92 && source === "card") || (c === 107 && source === "card" && target !== this.me),
    );
    if (usable.length > 0 && !this.inNebula(target)) {
      const a = await this.game.ask({
        kind: "react",
        player: target,
        cards: [...new Set(usable)],
        title: "Defend yourself?",
        text: opts.text ?? `${this.title() ?? "Something"} is about to hit you. Play a card to stop it?`,
      });
      const c = "card" in a ? a.card : null;
      if (c !== null) {
        this.game.discardFromHand(t, c);
        this.game.log(`${t.name} played ${cardName(c)}!`, { player: target, card: { id: c, deck: "B" } });
        if (c === 107) {
          await apply(this.me);
        }
        return;
      }
    }
    await apply(target);
  }

  private title(): string | undefined {
    return this.card ? cardName(this.card) : undefined;
  }
}

export function listOr(ns: number[]): string {
  if (ns.length === 1) return `a ${ns[0]}`;
  return `a ${ns.slice(0, -1).join(", ")} or ${ns[ns.length - 1]}`;
}

export type { BonusCard };
export { progress };
