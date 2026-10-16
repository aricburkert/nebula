import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GameView } from "../engine/game";
import type { ChatMessage, RoomInfo } from "../shared/protocol";
import { Board } from "./Board";
import { PromptPanel } from "./PromptPanel";
import { CARD_TEXT, PASSIVE_HINT, SPINNER, cardAlt, cardSrc, cardTitle } from "./cards";
import type { RoomConnection } from "./useRoom";
import { WorldLayer } from "./WorldLayer";
import { Director, useDirector, type DirectorSnapshot } from "./three/director";
import { pawnColor, SPACES } from "./three/palette";
import { setSettings, useSettings } from "./settings";
import { sfx } from "./sfx";

interface Props {
  conn: RoomConnection;
  room: RoomInfo;
  game: GameView;
}

export function GameScreen({ conn, room, game }: Props) {
  const me = game.players.find((p) => p.id === conn.you) ?? null;
  const names = useMemo(() => new Map(game.players.map((p) => [p.id, p.name])), [game.players]);
  const pending = game.pending;
  const pickable = pending?.kind === "pickSpace" && pending.player === conn.you ? pending.candidates : undefined;
  const settings = useSettings();

  const director = useMemo(() => new Director(), []);
  useLayoutEffect(() => director.ingest(game), [director, game]);
  // Lets the local screenshot scripts step through animations frame by frame.
  if (import.meta.env.DEV) (window as unknown as { __director: Director }).__director = director;
  // Without the 3D scene nothing drives the clock, so tick it here.
  useEffect(() => {
    if (settings.gl) return;
    const t = setInterval(() => director.tick(0.05), 50);
    return () => clearInterval(t);
  }, [director, settings.gl]);
  const snap = useDirector(director);

  const pawns = useMemo(
    () =>
      game.players.map((p) => ({
        id: p.id,
        pawn: p.pawn,
        name: p.name,
        asleep: p.skipTurns > 0,
        cursed: game.watchers.filter((w) => w.player === p.id).length,
        current: game.current === p.id && game.phase === "playing",
        you: p.id === conn.you,
      })),
    [game.players, game.watchers, game.current, game.phase, conn.you],
  );
  const traps = useMemo(() => game.traps.map((t) => ({ space: t.space, title: `${names.get(t.owner)}'s ${cardTitle(t.card)}` })), [game.traps, names]);
  const pick = (space: string) => pending && conn.send({ t: "answer", promptId: pending.id, answer: { space } });
  const winner = snap.win ? game.players.find((p) => p.id === snap.win) : null;
  const [drawer, setDrawer] = useState<"chat" | "log" | "hand" | null>(null);
  const [sideMin, setSideMin] = useState(() => {
    try {
      const v = localStorage.getItem("nebula:side");
      if (v) return v === "min";
    } catch {}
    return window.innerWidth < 1500;
  });
  const toggleSide = () =>
    setSideMin((m) => {
      try {
        localStorage.setItem("nebula:side", m ? "open" : "min");
      } catch {}
      return !m;
    });
  // Messages that arrived while the chat was tucked away.
  const seen = useRef(conn.chat.length);
  if (!sideMin && drawer !== "log") seen.current = conn.chat.length;
  const unread = conn.chat.slice(seen.current).filter((m) => m.player && m.player !== conn.you).length;
  const latest = conn.chat[conn.chat.length - 1];

  return (
    <main className="game">
      <WorldLayer mode="game" board={room.settings.board} director={director} pawns={pawns} you={conn.you} pickable={pickable} onPick={pick} traps={traps} decks={{ A: game.actionDeck, B: game.bonusDeck }} />
      {!settings.gl && (
        <div className="flat-board-wrap">
          <Board game={game} board={room.settings.board} pickable={pickable} onPick={pick} />
        </div>
      )}

      <div className="hud">
        <TopBar room={room} game={game} />
        <Players conn={conn} game={game} room={room} />
        <TurnBanner snap={snap} names={names} you={conn.you} />
        <RollCaption snap={snap} names={names} />
        <ActiveCard game={game} names={names} />
        <CardReveal snap={snap} names={names} fromDeck={settings.gl} />

        <div className={`side ${drawer ? "open" : ""} ${sideMin ? "min" : ""}`}>
          <div className="tabs">
            <button
              className={drawer !== "log" ? "on" : ""}
              onClick={() => {
                setDrawer("chat");
                if (sideMin && drawer !== "log") toggleSide();
              }}
            >
              Chat {unread > 0 && <span className="badge">{unread}</span>}
            </button>
            <button
              className={drawer === "log" ? "on" : ""}
              onClick={() => {
                setDrawer("log");
                if (sideMin && drawer === "log") toggleSide();
              }}
            >
              What happened
            </button>
            <button className="min-side" onClick={toggleSide} aria-label={sideMin ? "Show chat" : "Hide chat"} title={sideMin ? "Show" : "Hide"}>
              {sideMin ? "▾" : "▴"}
            </button>
            <button className="close-drawer" onClick={() => setDrawer(null)} aria-label="Close">
              ✕
            </button>
          </div>
          {drawer === "log" ? <Log game={game} /> : <Chat conn={conn} chat={conn.chat} game={game} />}
          {latest && (
            <button className="chat-peek" onClick={toggleSide}>
              <strong style={{ color: latest.player ? pawnColor(game.players.find((p) => p.id === latest.player)?.pawn ?? "") : undefined }}>{latest.name}</strong> {latest.text}
            </button>
          )}
        </div>

        <div className="bottom">
          {winner ? (
            <Winner name={winner.name} pawn={winner.pawn} isHost={room.host === conn.you} onRematch={() => conn.send({ t: "rematch" })} />
          ) : (
            <HeldPrompt busy={snap.busy} promptId={pending?.id ?? null} mine={!!pending && !!conn.you && promptFor(pending, conn.you)}>
              <PromptPanel conn={conn} game={game} names={names} />
            </HeldPrompt>
          )}
        </div>
        {me && <Hand game={game} hand={me.hand} open={drawer === "hand"} onToggle={() => setDrawer(drawer === "hand" ? null : "hand")} />}

        <nav className="mobile-tabs">
          <button onClick={() => setDrawer(drawer === "hand" ? null : "hand")} className={drawer === "hand" ? "on" : ""}>
            🃏 Hand {me && me.hand.length > 0 && <span className="badge">{me.hand.length}</span>}
          </button>
          <button onClick={() => setDrawer(drawer === "chat" ? null : "chat")} className={drawer === "chat" ? "on" : ""}>
            💬 Chat
          </button>
          <button onClick={() => setDrawer(drawer === "log" ? null : "log")} className={drawer === "log" ? "on" : ""}>
            📜 Log
          </button>
        </nav>
      </div>
    </main>
  );
}

function promptFor(p: NonNullable<GameView["pending"]>, you: string) {
  if ("player" in p) return p.player === you;
  if (p.kind === "vote") return p.voters.includes(you);
  if (p.kind === "race") return p.players.includes(you);
  return false;
}

/** Lets the dice land and the pawn finish hopping before the next question pops up (never more than a few seconds). */
function HeldPrompt({ busy, promptId, mine, children }: { busy: boolean; promptId: number | null; mine: boolean; children: ReactNode }) {
  const [heldId, setHeldId] = useState<number | null>(null);
  const busyNow = useRef(busy);
  busyNow.current = busy;
  useEffect(() => {
    if (!mine || promptId === null || !busyNow.current) return;
    setHeldId(promptId);
    const t = setTimeout(() => setHeldId((h) => (h === promptId ? null : h)), 3000);
    return () => clearTimeout(t);
  }, [promptId, mine]);
  useEffect(() => {
    if (!busy) setHeldId(null);
  }, [busy]);
  const held = heldId !== null && heldId === promptId;
  return <div className={`prompt-wrap ${held ? "held" : ""} ${mine ? "mine" : ""}`}>{children}</div>;
}

function TopBar({ room, game }: { room: RoomInfo; game: GameView }) {
  const s = useSettings();
  const [menu, setMenu] = useState(false);
  return (
    <header className="topbar">
      <a className="mini-logo" href="/" aria-label="The Nebula from Hell home">
        <img src="/assets/logo/title.webp" alt="The Nebula from Hell" />
      </a>
      <span className="room-chip">
        Room <b>{room.code}</b> · Round {game.round}
        {room.settings.board === "deep-space" && " · Deep Space"}
        {room.settings.videoCall && " · 📹"}
      </span>
      <span className="decks">
        <span className="deck deck-a" title="Action cards left">
          A <b>{game.actionDeck}</b>
        </span>
        <span className="deck deck-b" title="Bonus cards left">
          B <b>{game.bonusDeck}</b>
        </span>
      </span>
      <span className="spacer" />
      {s.gl && (
        <button className="icon-btn" title="Recenter the camera" onClick={() => setSettings({ recenter: s.recenter + 1 })}>
          🎯
        </button>
      )}
      <button className="icon-btn" title={s.muted ? "Sound off" : "Sound on"} onClick={() => setSettings({ muted: !s.muted })}>
        {s.muted ? "🔇" : "🔊"}
      </button>
      <button className="icon-btn" title="Settings" onClick={() => setMenu(!menu)} aria-expanded={menu}>
        ⚙️
      </button>
      {menu && (
        <div className="menu panel-glass" onMouseLeave={() => setMenu(false)}>
          <label className="menu-row">
            <input type="checkbox" checked={s.autoCam} onChange={(e) => setSettings({ autoCam: e.target.checked })} disabled={!s.gl} />
            Camera follows the action
          </label>
          <label className="menu-row">
            <input type="checkbox" checked={s.quality === "high"} onChange={(e) => setSettings({ quality: e.target.checked ? "high" : "low" })} disabled={!s.gl} />
            High quality graphics
          </label>
          <label className="menu-row">
            <input type="checkbox" checked={!s.muted} onChange={(e) => setSettings({ muted: !e.target.checked })} />
            Sound effects
          </label>
          <p className="menu-hint">Drag to look around, scroll or pinch to zoom, right-drag to pan.</p>
        </div>
      )}
    </header>
  );
}

function TurnBanner({ snap, names, you }: { snap: DirectorSnapshot; names: Map<string, string>; you: string | null }) {
  const a = snap.active;
  const [shown, setShown] = useState<{ id: number; text: string; mine: boolean } | null>(null);
  useEffect(() => {
    if (a?.ev.kind !== "turn") return;
    const mine = a.ev.player === you;
    setShown({ id: a.id, text: mine ? "Your turn!" : `${names.get(a.ev.player)}'s turn`, mine });
    const t = setTimeout(() => setShown(null), 1900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id]);
  if (!shown) return null;
  return (
    <div key={shown.id} className={`turn-banner ${shown.mine ? "mine" : ""}`}>
      <span>{shown.text}</span>
    </div>
  );
}

function RollCaption({ snap, names }: { snap: DirectorSnapshot; names: Map<string, string> }) {
  const [cap, setCap] = useState<{ id: string; text: string } | null>(null);
  const roll = snap.roll;
  const spin = snap.spin;
  useEffect(() => {
    if (!roll) return;
    const sum = roll.dice.reduce((x, y) => x + y, 0);
    const text = `${names.get(roll.player)} rolled ${roll.dice.length > 1 ? `${roll.dice.join(" + ")} = ${sum}` : sum}`;
    const a = setTimeout(() => setCap({ id: `r${roll.id}`, text }), 1100);
    const b = setTimeout(() => setCap((c) => (c?.id === `r${roll.id}` ? null : c)), 3600);
    return () => (clearTimeout(a), clearTimeout(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll?.id]);
  useEffect(() => {
    if (!spin) return;
    const s = SPINNER[spin.segment];
    const colors = Array.isArray(s.color) ? s.color.join(" / ") : s.color;
    const text = `${names.get(spin.player)} spun: ${s.text.toLowerCase()} (${colors})`;
    const a = setTimeout(() => setCap({ id: `s${spin.id}`, text }), 2800);
    const b = setTimeout(() => setCap((c) => (c?.id === `s${spin.id}` ? null : c)), 5600);
    return () => (clearTimeout(a), clearTimeout(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin?.id]);
  if (!cap) return null;
  return (
    <div key={cap.id} className="roll-caption">
      {cap.text}
    </div>
  );
}

/** A card flips up big in the middle of the screen, then tucks into the corner. */
function CardReveal({ snap, names, fromDeck }: { snap: DirectorSnapshot; names: Map<string, string>; fromDeck: boolean }) {
  const card = snap.card;
  const [gone, setGone] = useState<number | null>(null);
  const [phase, setPhase] = useState<"in" | "out">("in");
  // With the 3D scene, the card flies up off its deck first; this overlay takes over once it arrives.
  const landed = !fromDeck || (card && snap.landed === card.id);
  const [late, setLate] = useState<number | null>(null);
  useEffect(() => {
    if (!card || !fromDeck) return;
    const t = setTimeout(() => setLate(card.id), 2500);
    return () => clearTimeout(t);
  }, [card, fromDeck]);
  const showing = !!card && (landed || late === card.id);
  useEffect(() => {
    if (!card || !showing) return;
    setPhase("in");
    const t = setTimeout(() => setPhase("out"), 3000);
    const u = setTimeout(() => setGone(card.id), 3700);
    return () => (clearTimeout(t), clearTimeout(u));
  }, [card, showing]);
  if (!card || gone === card.id || !showing) return null;
  const who = card.player ? names.get(card.player) : null;
  const verb = /played/.test(card.text) ? "played" : /drew/.test(card.text) ? "drew" : null;
  return (
    <div className={`reveal ${phase} ${fromDeck ? "landed" : ""}`} onClick={() => setPhase("out")}>
      <div className="reveal-card" key={card.id}>
        <div className="reveal-face reveal-front">
          <img src={cardSrc(card.card)} alt={cardAlt(card.card)} />
        </div>
        <div className={`reveal-face reveal-back deck-${card.deck}`}>
          <span>{card.deck}</span>
        </div>
      </div>
      <div className="reveal-caption">{who && verb ? `${who} ${verb} ${cardTitle(card.card)}` : card.text}</div>
    </div>
  );
}

function ActiveCard({ game, names }: { game: GameView; names: Map<string, string> }) {
  const active = game.active;
  const [big, setBig] = useState(false);
  if (!active) return null;
  return (
    <>
      <button className="active-card" onClick={() => setBig(true)} title="Show the card">
        <div className="small">
          {names.get(active.player)}'s {active.deck === "A" ? "Action" : "Bonus"} card
        </div>
        <img src={cardSrc(active.card)} alt={cardAlt(active.card)} />
      </button>
      {big && (
        <div className="card-zoom" onClick={() => setBig(false)}>
          <img src={cardSrc(active.card)} alt={cardAlt(active.card)} />
        </div>
      )}
    </>
  );
}

export function CardImage({ id, big }: { id: number; big?: boolean }) {
  return <img className={`card-img ${big ? "big" : ""}`} src={cardSrc(id)} alt={cardAlt(id)} loading="lazy" />;
}

const ORDER = new Map<string, number>();
{
  // How far along the track each space is, for the progress bars.
  const seen = new Set<string>();
  const walk = (id: string, d: number) => {
    if (seen.has(id) && (ORDER.get(id) ?? 0) >= d) return;
    seen.add(id);
    ORDER.set(id, Math.max(ORDER.get(id) ?? 0, d));
    for (const n of SPACES.find((s) => s.id === id)?.next ?? []) if (n !== "finish") walk(n, d + 1);
  };
  walk(SPACES[0].id, 1);
}
const MAX_ORDER = Math.max(...ORDER.values()) + 1;

function Players({ conn, game, room }: { conn: RoomConnection; game: GameView; room: RoomInfo }) {
  const online = new Map(room.players.map((p) => [p.id, p.connected]));
  const bots = new Set(room.players.filter((p) => p.bot).map((p) => p.id));
  return (
    <section className="players">
      {game.players.map((p) => {
        const curses = game.watchers.filter((w) => w.player === p.id);
        const status =
          p.pos.kind === "nebula"
            ? `🌀 In the NEBULA (${p.nebulaTurns})`
            : p.pos.kind === "start"
              ? "At START"
              : p.pos.kind === "finish"
                ? "🏁 FINISHED"
                : p.skipTurns
                  ? `💤 Asleep (${p.skipTurns})`
                  : "";
        const prog = p.pos.kind === "finish" ? 1 : p.pos.kind === "space" ? (ORDER.get(p.pos.id) ?? 0) / MAX_ORDER : p.pos.kind === "nebula" ? (ORDER.get("b7") ?? 0) / MAX_ORDER : 0;
        const current = game.current === p.id && game.phase === "playing";
        return (
          <div key={p.id} className={`player-card ${current ? "current" : ""} ${online.get(p.id) ? "" : "offline"}`} style={{ "--pc": pawnColor(p.pawn) } as CSSProperties}>
            <div className="portrait">
              <img src={`/assets/pawns/${p.pawn}.png`} alt="" />
            </div>
            <div className="player-info">
              <div className="player-name">
                <strong>{p.name}</strong>
                {p.id === conn.you && <span className="tag">you</span>}
                {bots.has(p.id) && <span className="tag">cpu</span>}
                {!online.get(p.id) && <span className="tag warn">offline</span>}
              </div>
              <div className="progress">
                <span style={{ width: `${Math.round(prog * 100)}%` }} />
              </div>
              <div className="player-meta">
                <span className="mini-card" title="Bonus cards">
                  {p.hand.length}
                </span>
                {status && <span>{status}</span>}
              </div>
              {curses.map((w) => (
                <div key={w.id} className="curse">
                  ☠ {w.label}
                  {conn.you && conn.you !== p.id && (w.card === 75 || w.card === 90) && (
                    <button
                      className="btn tiny"
                      onClick={() =>
                        conn.send({
                          t: "gotcha",
                          target: p.id,
                          card: w.card,
                          reason: w.card === 75 ? 'said "um" or "like"' : "laughed",
                        })
                      }
                    >
                      Caught them!
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Hand({ game, hand, open, onToggle }: { game: GameView; hand: number[]; open: boolean; onToggle: () => void }) {
  const playable = game.pending?.kind === "turn" ? game.pending.playable : [];
  const [zoom, setZoom] = useState<number | null>(null);
  const n = hand.length;
  return (
    <section className={`hand ${open ? "open" : ""}`}>
      <button className="hand-label" onClick={onToggle}>
        Your Bonus cards <span className="badge">{n}</span>
      </button>
      {n === 0 ? (
        <div className="hand-empty">Land on a Bonus space to collect one.</div>
      ) : (
        <div className="hand-fan">
          {hand.map((c, i) => {
            const mid = (n - 1) / 2;
            const rot = n > 1 ? (i - mid) * Math.min(9, 40 / n) : 0;
            return (
              <figure
                key={`${c}-${i}`}
                className={playable.includes(c) ? "playable" : ""}
                style={{ "--rot": `${rot}deg`, "--lift": `${Math.abs(i - mid) * 6}px`, zIndex: i } as CSSProperties}
                onClick={() => setZoom(c)}
              >
                <CardImage id={c} />
                <figcaption>{PASSIVE_HINT[c] ?? (playable.includes(c) ? "Play it from the turn menu." : CARD_TEXT.get(c)?.title)}</figcaption>
              </figure>
            );
          })}
        </div>
      )}
      {zoom !== null && (
        <div className="card-zoom" onClick={() => setZoom(null)}>
          <img src={cardSrc(zoom)} alt={cardAlt(zoom)} />
          {PASSIVE_HINT[zoom] && <p>{PASSIVE_HINT[zoom]}</p>}
        </div>
      )}
    </section>
  );
}

const TURN_PHRASE = /\b(my|your) turn\b/i;

function Chat({ conn, chat, game }: { conn: RoomConnection; chat: ChatMessage[]; game: GameView }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length]);
  const me = game.players.find((p) => p.id === conn.you);
  const colors = new Map(game.players.map((p) => [p.id, pawnColor(p.pawn)]));
  const hasMyTurn = me?.hand.includes(99);
  return (
    <section className="chat">
      <div className="chat-list" ref={list}>
        {chat.map((m) => (
          <div key={m.id} className={`chat-msg ${m.player === null ? "system" : ""}`}>
            <strong style={{ color: m.player ? colors.get(m.player) : undefined }}>{m.name}</strong> {m.text}
            {hasMyTurn && m.player && m.player !== conn.you && TURN_PHRASE.test(m.text) && (
              <button className="btn tiny" onClick={() => conn.send({ t: "gotcha", target: m.player!, card: 99, reason: m.text.match(TURN_PHRASE)![0] })}>
                Gotcha! Back to START
              </button>
            )}
          </div>
        ))}
        {chat.length === 0 && <div className="muted small">Talk trash here.</div>}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          conn.send({ t: "chat", text });
          sfx.click();
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={300} aria-label="Chat message" />
        <button className="btn" type="submit">
          Send
        </button>
      </form>
    </section>
  );
}

function Log({ game }: { game: GameView }) {
  const entries = game.log.slice(-60).reverse();
  return (
    <section className="log">
      <ol>
        {entries.map((e) => (
          <li key={e.n}>
            {e.card && <span className={`tag deck-${e.card.deck}`}>{e.card.deck}</span>}
            {e.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Winner({ name, pawn, isHost, onRematch }: { name: string; pawn: string; isHost: boolean; onRematch: () => void }) {
  return (
    <section className="winner panel-glass">
      <img src={`/assets/pawns/${pawn}.png`} alt="" />
      <div>
        <h2>{name} wins!</h2>
        <p>They escaped the Grappling Hook and made it to FINISH.</p>
        {isHost ? (
          <button className="btn big" onClick={onRematch}>
            Back to the lobby for a rematch
          </button>
        ) : (
          <p className="muted">The host can start a rematch.</p>
        )}
      </div>
    </section>
  );
}
