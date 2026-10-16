import { DurableObject } from "cloudflare:workers";
import { Game, type GameConfig } from "../engine/game";
import { botInput, promptPlayers } from "../engine/bot";
import { Rng } from "../engine/rng";
import type { Input } from "../engine/types";
import { MAX_PLAYERS, PAWNS, type ChatMessage, type ClientMsg, type RoomInfo, type ServerMsg } from "../shared/protocol";

interface Member {
  id: string;
  name: string;
  pawn: string;
  token: string;
}

interface Meta {
  code: string;
  host: string | null;
  phase: "lobby" | "playing" | "over";
  members: Member[];
  settings: { videoCall: boolean };
  config: GameConfig | null;
  chatSeq: number;
  /** Chat message ids already used as evidence for a "Gotcha". */
  usedEvidence: number[];
}

const VOTE_TIMEOUT_MS = 120_000;
const ABSENT_BOT_MS = 20_000;
const CHAT_KEEP = 100;

/** One game room. Holds the lobby, the chat and the authoritative game, rebuilt from its input log after a restart. */
export class Room extends DurableObject {
  private meta!: Meta;
  private inputs: Input[] = [];
  private chat: ChatMessage[] = [];
  private game: Game | null = null;
  private sockets = new Map<WebSocket, { player: string | null }>();
  private lock: Promise<unknown> = Promise.resolve();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private loaded: Promise<void>;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.loaded = ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load() {
    const meta = await this.ctx.storage.get<Meta>("meta");
    this.meta = meta ?? {
      code: "",
      host: null,
      phase: "lobby",
      members: [],
      settings: { videoCall: false },
      config: null,
      chatSeq: 0,
      usedEvidence: [],
    };
    this.chat = (await this.ctx.storage.get<ChatMessage[]>("chat")) ?? [];
    const rows = await this.ctx.storage.list<Input>({ prefix: "in:" });
    this.inputs = [...rows.values()];
    if (this.meta.config && this.meta.phase !== "lobby") {
      try {
        this.game = await Game.replay(this.meta.config, this.inputs);
      } catch (e) {
        console.error("Replay failed", e);
        this.game = null;
        this.meta.phase = "lobby";
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.loaded;
    const code = new URL(request.url).pathname.slice(1);
    if (!this.meta.code) {
      this.meta.code = code;
      await this.saveMeta();
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    this.sockets.set(server, { player: null });
    server.addEventListener("message", (ev) => {
      this.serialize(() => this.onMessage(server, ev.data as string));
    });
    const gone = () => this.serialize(() => this.onClose(server));
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private serialize(fn: () => Promise<void> | void) {
    this.lock = this.lock.then(fn).catch((e) => console.error(e));
  }

  // ------------------------------------------------------------ messages

  private async onMessage(ws: WebSocket, raw: string) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const conn = this.sockets.get(ws);
    if (!conn) return;
    const me = conn.player;
    switch (msg.t) {
      case "hello": {
        const m = msg.token ? this.meta.members.find((x) => x.token === msg.token) : undefined;
        conn.player = m?.id ?? null;
        this.send(ws, { t: "welcome", you: conn.player });
        this.send(ws, { t: "room", room: this.roomInfo() });
        this.send(ws, { t: "chat", messages: this.chat });
        if (this.game) this.send(ws, { t: "state", game: this.game.view(conn.player) });
        if (m) this.broadcastRoom();
        this.schedule();
        return;
      }
      case "join": {
        if (me) return this.error(ws, "You're already in this room.");
        if (this.meta.phase !== "lobby") return this.error(ws, "This game has already started. You can watch.");
        if (this.meta.members.length >= MAX_PLAYERS) return this.error(ws, "This room is full.");
        const name = String(msg.name ?? "").trim().slice(0, 20);
        if (!name) return this.error(ws, "Pick a name.");
        if (!PAWNS.some((p) => p.id === msg.pawn) || this.meta.members.some((m) => m.pawn === msg.pawn))
          return this.error(ws, "That pawn is taken.");
        const member: Member = { id: crypto.randomUUID().slice(0, 8), name, pawn: msg.pawn, token: crypto.randomUUID() };
        this.meta.members.push(member);
        this.meta.host ??= member.id;
        conn.player = member.id;
        await this.saveMeta();
        this.send(ws, { t: "welcome", you: member.id, token: member.token });
        this.broadcastRoom();
        return;
      }
      case "pawn": {
        const m = this.member(me);
        if (!m || this.meta.phase !== "lobby") return;
        if (!PAWNS.some((p) => p.id === msg.pawn) || this.meta.members.some((x) => x.pawn === msg.pawn && x.id !== m.id))
          return this.error(ws, "That pawn is taken.");
        m.pawn = msg.pawn;
        await this.saveMeta();
        this.broadcastRoom();
        return;
      }
      case "settings": {
        if (me !== this.meta.host || this.meta.phase !== "lobby") return;
        this.meta.settings = { videoCall: !!msg.videoCall };
        await this.saveMeta();
        this.broadcastRoom();
        return;
      }
      case "start": {
        if (me !== this.meta.host || this.meta.phase !== "lobby") return;
        if (this.meta.members.length < 2) return this.error(ws, "You need at least 2 players.");
        await this.startGame();
        return;
      }
      case "rematch": {
        if (me !== this.meta.host || this.meta.phase !== "over") return;
        await this.ctx.storage.delete([...(await this.ctx.storage.list({ prefix: "in:" })).keys()]);
        this.inputs = [];
        this.game = null;
        this.meta.phase = "lobby";
        this.meta.config = null;
        await this.saveMeta();
        this.broadcastRoom();
        for (const [s] of this.sockets) this.send(s, { t: "state", game: null });
        return;
      }
      case "answer": {
        if (!me || !this.game) return;
        await this.submit({ promptId: msg.promptId, player: me, answer: msg.answer }, ws);
        return;
      }
      case "gotcha": {
        if (!me || !this.game) return;
        const evidenceErr = this.checkEvidence(msg.card, msg.target);
        if (evidenceErr) return this.error(ws, evidenceErr);
        await this.submit({ interrupt: "gotcha", player: me, target: msg.target, card: msg.card, reason: String(msg.reason).slice(0, 80) }, ws);
        return;
      }
      case "nudge": {
        // Anyone can let the computer answer for players who stopped responding.
        if (!me || !this.game?.state.pending) return;
        const waitingOn = promptPlayers(this.game.state.pending);
        if (waitingOn.includes(me)) return;
        await this.botMove(`${this.member(me)?.name ?? "Someone"} let the computer play for ${waitingOn.map((p) => this.member(p)?.name).join(", ")}.`);
        return;
      }
      case "chat": {
        const text = String(msg.text ?? "").trim().slice(0, 300);
        if (!text) return;
        const m = this.member(me);
        const message: ChatMessage = { id: ++this.meta.chatSeq, player: me, name: m?.name ?? "Spectator", text, at: Date.now() };
        this.chat.push(message);
        if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
        await this.ctx.storage.put("chat", this.chat);
        await this.saveMeta();
        for (const [s] of this.sockets) this.send(s, { t: "chat", messages: [message] });
        return;
      }
    }
  }

  private async onClose(ws: WebSocket) {
    const conn = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (conn?.player) {
      this.broadcastRoom();
      this.schedule();
    }
  }

  /** "My Turn! Your Turn!" (99) and "Um!" (75, without a video call) need a chat message from the target as proof. */
  private checkEvidence(card: number, target: string): string | null {
    const pattern = card === 99 ? /\b(my|your) turn\b/i : card === 75 && !this.meta.settings.videoCall ? /\b(u+m+|like)\b/i : null;
    if (!pattern) return null;
    const msg = [...this.chat].reverse().find((c) => c.player === target && pattern.test(c.text) && !this.meta.usedEvidence.includes(c.id));
    if (!msg) return card === 99 ? `${this.member(target)?.name} hasn't typed "my turn" or "your turn".` : `${this.member(target)?.name} hasn't typed "um" or "like".`;
    this.meta.usedEvidence.push(msg.id);
    return null;
  }

  // ------------------------------------------------------------ game

  private async startGame() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const config: GameConfig = {
      seed,
      settings: this.meta.settings,
      players: this.meta.members.map((m) => ({ id: m.id, name: m.name, pawn: m.pawn })),
    };
    this.meta.config = config;
    this.meta.phase = "playing";
    this.inputs = [];
    this.game = new Game(config);
    await this.game.start();
    await this.saveMeta();
    this.broadcastRoom();
    this.broadcastState();
    this.schedule();
  }

  private async submit(input: Input, ws?: WebSocket) {
    const game = this.game;
    if (!game) return;
    const r = await game.submit(input);
    if (!r.ok) {
      if (ws) this.error(ws, r.error);
      return;
    }
    await this.ctx.storage.put(`in:${String(this.inputs.length).padStart(6, "0")}`, input);
    this.inputs.push(input);
    if (game.state.phase === "over" && this.meta.phase !== "over") {
      this.meta.phase = "over";
      await this.saveMeta();
      this.broadcastRoom();
    }
    this.broadcastState();
    this.schedule();
  }

  private async botMove(note?: string) {
    if (!this.game) return;
    const input = botInput(this.game, new Rng((this.meta.config?.seed ?? 1) ^ (this.inputs.length * 2654435761)));
    if (!input) return;
    if (note) {
      const message: ChatMessage = { id: ++this.meta.chatSeq, player: null, name: "Nebula", text: note, at: Date.now() };
      this.chat.push(message);
      for (const [s] of this.sockets) this.send(s, { t: "chat", messages: [message] });
    }
    await this.submit(input);
  }

  /** Sets the timers for the current prompt: countdowns, vote deadlines, and stand-ins for absent players. */
  private schedule() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const p = this.game?.state.pending;
    if (!p || this.game?.state.phase !== "playing") return;
    const id = p.id;
    const stillPending = () => this.game?.state.pending?.id === id;
    if (p.kind === "timer") {
      this.timers.push(
        setTimeout(() => this.serialize(() => (stillPending() ? this.submit({ promptId: id, player: "system", timeout: true }) : undefined)), p.seconds * 1000 + 1500),
      );
    }
    if (p.kind === "vote" || p.kind === "race") {
      this.timers.push(
        setTimeout(() => this.serialize(() => (stillPending() ? this.submit({ promptId: id, player: "system", timeout: true }) : undefined)), VOTE_TIMEOUT_MS),
      );
    }
    const online = new Set([...this.sockets.values()].map((c) => c.player).filter(Boolean));
    if (promptPlayers(p).every((pl) => !online.has(pl))) {
      this.timers.push(setTimeout(() => this.serialize(() => (stillPending() ? this.botMove() : undefined)), ABSENT_BOT_MS));
    }
  }

  // ------------------------------------------------------------ output

  private member(id: string | null) {
    return id ? this.meta.members.find((m) => m.id === id) : undefined;
  }

  private roomInfo(): RoomInfo {
    const online = new Set([...this.sockets.values()].map((c) => c.player));
    return {
      code: this.meta.code,
      host: this.meta.host,
      phase: this.meta.phase,
      settings: this.meta.settings,
      players: this.meta.members.map((m) => ({ id: m.id, name: m.name, pawn: m.pawn, connected: online.has(m.id) })),
    };
  }

  private broadcastRoom() {
    const room = this.roomInfo();
    for (const [s] of this.sockets) this.send(s, { t: "room", room });
  }

  private broadcastState() {
    if (!this.game) return;
    for (const [s, c] of this.sockets) this.send(s, { t: "state", game: this.game.view(c.player) });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket already closed
    }
  }

  private error(ws: WebSocket, error: string) {
    this.send(ws, { t: "error", error });
  }

  private saveMeta() {
    return this.ctx.storage.put("meta", this.meta);
  }
}
