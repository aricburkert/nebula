import { DurableObject } from "cloudflare:workers";
import { Game, type GameConfig } from "../engine/game";
import { botInput, promptPlayers } from "../engine/bot";
import { Rng } from "../engine/rng";
import { isCardPause, type Input } from "../engine/types";
import { isBoard, MAX_PLAYERS, pawnOnBoard, pawnsFor, PAWNS, type BoardId, type ChatMessage, type ClientMsg, type RoomInfo, type ServerMsg } from "../shared/protocol";

interface Member {
  id: string;
  name: string;
  pawn: string;
  token: string;
  bot?: boolean;
}

interface Meta {
  code: string;
  host: string | null;
  phase: "lobby" | "playing" | "over";
  members: Member[];
  settings: { videoCall: boolean; board: BoardId };
  config: GameConfig | null;
  chatSeq: number;
  /** Chat message ids already used as evidence for a "Gotcha". */
  usedEvidence: number[];
}

const VOTE_TIMEOUT_MS = 120_000;
const ABSENT_BOT_MS = 20_000;
const CHAT_KEEP = 100;
// Long enough for the dice to land and the pawn to finish hopping before the next move.
const BOT_THINK_MS = 2200;
// Long enough for the card to fly up and for everyone to read a computer player's card.
const BOT_READ_MS = 5000;
const BOT_NAMES = ["Robo Rita", "Beep Boop Bob", "Sparky", "Unit 42", "Captain Chip", "Hal 9001", "Gizmo", "Toaster"];

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
      settings: { videoCall: false, board: "standard" },
      config: null,
      chatSeq: 0,
      usedEvidence: [],
    };
    // Rooms made before there was a board choice are Standard.
    if (!isBoard(this.meta.settings.board)) this.meta.settings.board = "standard";
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
        const m = msg.token ? this.meta.members.find((x) => !x.bot && x.token === msg.token) : undefined;
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
        const pawn = pawnOnBoard(String(msg.pawn), this.meta.settings.board);
        if (!PAWNS.some((p) => p.id === pawn) || this.meta.members.some((m) => m.pawn === pawn)) return this.error(ws, "That pawn is taken.");
        const member: Member = { id: crypto.randomUUID().slice(0, 8), name, pawn, token: crypto.randomUUID() };
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
        const pawn = pawnOnBoard(String(msg.pawn), this.meta.settings.board);
        if (!PAWNS.some((p) => p.id === pawn) || this.meta.members.some((x) => x.pawn === pawn && x.id !== m.id)) return this.error(ws, "That pawn is taken.");
        m.pawn = pawn;
        await this.saveMeta();
        this.broadcastRoom();
        return;
      }
      case "settings": {
        if (me !== this.meta.host || this.meta.phase !== "lobby") return;
        const board = isBoard(msg.board) ? msg.board : this.meta.settings.board;
        this.meta.settings = { videoCall: msg.videoCall === undefined ? this.meta.settings.videoCall : !!msg.videoCall, board };
        // Everyone swaps to the same character in the other edition (twins never clash, so nobody loses their pick).
        for (const m of this.meta.members) m.pawn = pawnOnBoard(m.pawn, board);
        await this.saveMeta();
        this.broadcastRoom();
        return;
      }
      case "addBot": {
        if (me !== this.meta.host || this.meta.phase !== "lobby") return;
        if (this.meta.members.length >= MAX_PLAYERS) return this.error(ws, "This room is full.");
        const pawns = pawnsFor(this.meta.settings.board).filter((p) => !this.meta.members.some((m) => m.pawn === p.id));
        const name = BOT_NAMES.find((n) => !this.meta.members.some((m) => m.name === n)) ?? `Bot ${this.meta.members.length + 1}`;
        const pawn = pawns[Math.floor(Math.random() * pawns.length)];
        this.meta.members.push({ id: crypto.randomUUID().slice(0, 8), name, pawn: pawn.id, token: "", bot: true });
        await this.saveMeta();
        this.broadcastRoom();
        return;
      }
      case "removeBot": {
        if (me !== this.meta.host || this.meta.phase !== "lobby") return;
        this.meta.members = this.meta.members.filter((m) => !(m.bot && m.id === msg.player));
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
      cardPause: true,
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

  private async botMove(note?: string, only?: Set<string>) {
    if (!this.game) return;
    const input = botInput(this.game, new Rng((this.meta.config?.seed ?? 1) ^ (this.inputs.length * 2654435761)), only);
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
    const bots = new Set(this.meta.members.filter((m) => m.bot).map((m) => m.id));
    const waiting = promptPlayers(p);
    if (waiting.some((pl) => bots.has(pl))) {
      // Computer players answer after a short pause so people can follow along; in a race they need time to "add up".
      const delay =
        p.kind === "race" ? 3000 + Math.random() * 4000 : p.kind === "timer" ? Math.min(p.seconds * 1000, 4000) : isCardPause(p) ? BOT_READ_MS : BOT_THINK_MS;
      this.timers.push(setTimeout(() => this.serialize(() => (stillPending() ? this.botMove(undefined, bots) : undefined)), delay));
    }
    const online = new Set([...this.sockets.values()].map((c) => c.player).filter(Boolean));
    const humans = waiting.filter((pl) => !bots.has(pl));
    if (humans.length && humans.every((pl) => !online.has(pl))) {
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
      players: this.meta.members.map((m) => ({ id: m.id, name: m.name, pawn: m.pawn, connected: !!m.bot || online.has(m.id), bot: m.bot })),
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
