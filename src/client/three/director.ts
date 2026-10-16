import { useSyncExternalStore } from "react";
import type { GameView } from "../../engine/game";
import type { Motion, Pos } from "../../engine/types";

/**
 * Turns the stream of game states from the server into a timeline of things to show:
 * dice tumbling, the spinner spinning, cards flipping, pawns hopping. The scene and the HUD
 * both read from one Director so they stay in step. Nothing here changes the game.
 */
export type FxEvent =
  | { kind: "intro" }
  | { kind: "roll"; player: string; dice: number[] }
  | { kind: "spin"; player: string; segment: number }
  | { kind: "card"; player?: string; card: number; deck: "A" | "B"; text: string }
  | { kind: "move"; motion: Motion }
  | { kind: "turn"; player: string }
  | { kind: "win"; player: string };

export interface Running {
  id: number;
  ev: FxEvent;
  /** Seconds, on the director clock. */
  start: number;
  dur: number;
}

export interface DirectorSnapshot {
  active: Running | null;
  busy: boolean;
  /** The latest card shown, for the reveal overlay. */
  card: (Extract<FxEvent, { kind: "card" }> & { id: number }) | null;
  roll: (Extract<FxEvent, { kind: "roll" }> & { id: number }) | null;
  spin: (Extract<FxEvent, { kind: "spin" }> & { id: number }) | null;
  win: string | null;
  /** The card (by event id) that has finished flying up to the camera, so the readable overlay can take over. */
  landed: number | null;
}

const ROLL_OFF = /to see who goes first/;

export function durationOf(ev: FxEvent): number {
  switch (ev.kind) {
    case "intro":
      return 2.6;
    case "roll":
      return 1.9;
    case "spin":
      return 3.3;
    case "card":
      return 2.2;
    case "turn":
      return 0.5;
    case "win":
      return 3.5;
    case "move": {
      const m = ev.motion;
      if (m.how === "walk") return 0.3 * Math.max(1, m.path?.length ?? 1) + 0.25;
      if (m.how === "nebula") return 1.7;
      if (m.how === "unnebula") return 1.2;
      if (m.how === "finish") return 2.2;
      return 1.35;
    }
  }
}

export class Director {
  queue: FxEvent[] = [];
  active: Running | null = null;
  /** Where each pawn is drawn when it isn't mid-animation. */
  shown = new Map<string, Pos>();
  truth = new Map<string, Pos>();
  clock = 0;
  speed = 1;
  private seq = 0;
  private lastLog = -1;
  private lastMotion = -1;
  private lastCurrent: string | null = null;
  private lastWinner: string | null = null;
  private inited = false;
  private snap: DirectorSnapshot = { active: null, busy: false, card: null, roll: null, spin: null, win: null, landed: null };
  private listeners = new Set<() => void>();
  private idleSince = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  private emit(patch: Partial<DirectorSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Feed every state the server sends. */
  ingest(game: GameView) {
    for (const p of game.players) this.truth.set(p.id, p.pos);
    const maxLog = game.log.length ? game.log[game.log.length - 1].n : 0;
    const maxMotion = game.motions?.length ? game.motions[game.motions.length - 1].n : 0;
    const restarted = this.inited && (maxLog < this.lastLog || maxMotion < this.lastMotion);
    if (!this.inited || restarted) {
      this.inited = true;
      this.queue = [];
      this.active = null;
      this.shown = new Map(this.truth);
      this.lastLog = maxLog;
      this.lastMotion = maxMotion;
      this.lastCurrent = game.current;
      this.lastWinner = game.winner;
      // A brand-new game (only the roll for who goes first so far) gets the fly-in.
      const fresh = game.log.every((e) => !e.card) && (game.motions?.length ?? 0) === 0 && game.round === 1;
      if (fresh) this.queue.push({ kind: "intro" }, { kind: "turn", player: game.current });
      this.emit({ busy: this.queue.length > 0, win: game.winner, card: null, roll: null, spin: null });
      return;
    }

    const items: { key: number; sub: number; ev: FxEvent }[] = [];
    for (const e of game.log) {
      if (e.n <= this.lastLog) continue;
      if (e.dice && !ROLL_OFF.test(e.text) && e.player) items.push({ key: e.n, sub: 0, ev: { kind: "roll", player: e.player, dice: e.dice } });
      if (e.spin !== undefined && e.player) items.push({ key: e.n, sub: 0, ev: { kind: "spin", player: e.player, segment: e.spin } });
      if (e.card) items.push({ key: e.n, sub: 0, ev: { kind: "card", player: e.player, card: e.card.id, deck: e.card.deck, text: e.text } });
    }
    for (const m of game.motions ?? []) {
      if (m.n <= this.lastMotion) continue;
      items.push({ key: m.after, sub: 1 + m.n / 1e6, ev: { kind: "move", motion: m } });
    }
    items.sort((a, b) => a.key - b.key || a.sub - b.sub);
    this.queue.push(...items.map((i) => i.ev));
    if (game.winner && game.winner !== this.lastWinner) this.queue.push({ kind: "win", player: game.winner });
    else if (game.current !== this.lastCurrent && game.phase === "playing") this.queue.push({ kind: "turn", player: game.current });
    this.lastLog = maxLog;
    this.lastMotion = maxMotion;
    this.lastCurrent = game.current;
    this.lastWinner = game.winner;
    if (this.queue.length && !this.snap.busy) this.emit({ busy: true });
  }

  /** Advance the timeline. Called every frame by the scene (or by a timer when there is no scene). */
  tick(dt: number) {
    this.speed = this.queue.length > 8 ? 3 : this.queue.length > 3 ? 1.7 : 1;
    this.clock += dt * this.speed;
    if (this.active && this.clock >= this.active.start + this.active.dur) {
      this.finish(this.active.ev);
      this.active = null;
    }
    // Way behind (the tab was hidden): skip ahead so people see the present.
    while (this.queue.length > 20) this.finish(this.queue.shift()!);
    if (!this.active && this.queue.length) {
      const ev = this.queue.shift()!;
      this.active = { id: ++this.seq, ev, start: this.clock, dur: durationOf(ev) };
      const patch: Partial<DirectorSnapshot> = { active: this.active, busy: true };
      if (ev.kind === "card") patch.card = { ...ev, id: this.active.id };
      if (ev.kind === "roll") patch.roll = { ...ev, id: this.active.id };
      if (ev.kind === "spin") patch.spin = { ...ev, id: this.active.id };
      if (ev.kind === "win") patch.win = ev.player;
      this.emit(patch);
    }
    if (!this.active && !this.queue.length) {
      if (this.snap.busy) {
        this.idleSince = this.clock;
        this.emit({ active: null, busy: false });
      }
      // Whatever we missed, put pawns where the game says they are.
      for (const [id, pos] of this.truth) {
        const s = this.shown.get(id);
        if (!s || s.kind !== pos.kind || (s.kind === "space" && pos.kind === "space" && s.id !== pos.id)) this.shown.set(id, pos);
      }
    }
  }

  /** The 3D card reached the camera. */
  land(id: number) {
    if (this.snap.landed !== id) this.emit({ landed: id });
  }

  idleFor() {
    return this.active || this.queue.length ? 0 : this.clock - this.idleSince;
  }

  private finish(ev: FxEvent) {
    if (ev.kind === "move") this.shown.set(ev.motion.player, ev.motion.to);
  }

  /** 0..1 progress of the running event. */
  progress(r: Running) {
    return Math.min(1, Math.max(0, (this.clock - r.start) / r.dur));
  }
}

export function useDirector(d: Director) {
  return useSyncExternalStore(d.subscribe, d.getSnapshot);
}
