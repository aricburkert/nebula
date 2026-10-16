import { useEffect, useMemo, useRef, useState } from "react";
import type { GameView } from "../engine/game";
import type { ChatMessage, RoomInfo } from "../shared/protocol";
import { Board } from "./Board";
import { PromptPanel } from "./PromptPanel";
import { CARD_TEXT, PASSIVE_HINT, SPINNER, cardAlt, cardSrc, cardTitle } from "./cards";
import type { RoomConnection } from "./useRoom";

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
  const winner = game.winner ? game.players.find((p) => p.id === game.winner) : null;

  return (
    <main className="game">
      <header className="game-header">
        <span className="logo tiny-logo">
          <span className="logo-nebula">Nebula</span> <span className="logo-hell">from Hell</span>
        </span>
        <span className="muted small">
          Room {room.code} · Round {game.round} · {room.settings.videoCall ? "Video call cards on" : "Chat only"}
        </span>
      </header>

      <div className="game-grid">
        <div className="col-board">
          <Board
            game={game}
            pickable={pickable}
            onPick={(space) => pending && conn.send({ t: "answer", promptId: pending.id, answer: { space } })}
          />
          {winner ? (
            <section className="panel prompt winner-panel">
              <h2>🎉 {winner.name} wins!</h2>
              <p>They escaped the Grappling Hook and made it to FINISH.</p>
              {room.host === conn.you ? (
                <button className="btn big" onClick={() => conn.send({ t: "rematch" })}>
                  Back to the lobby for a rematch
                </button>
              ) : (
                <p className="muted">The host can start a rematch.</p>
              )}
            </section>
          ) : (
            <PromptPanel conn={conn} game={game} names={names} />
          )}
          <TableCenter game={game} names={names} />
        </div>

        <aside className="col-side">
          <Players conn={conn} game={game} room={room} />
          {me && <Hand game={game} hand={me.hand} />}
          <Chat conn={conn} chat={conn.chat} game={game} />
          <Log game={game} />
        </aside>
      </div>
    </main>
  );
}

function TableCenter({ game, names }: { game: GameView; names: Map<string, string> }) {
  const active = game.active;
  return (
    <section className="panel table-center">
      <div className="active-card">
        {active ? (
          <>
            <div className="muted small">
              {names.get(active.player)}'s {active.deck === "A" ? "Action" : "Bonus"} card
            </div>
            <CardImage id={active.card} big />
          </>
        ) : (
          <div className="card-back">
            <span>A</span>
          </div>
        )}
      </div>
      <div className="table-side">
        <Dice game={game} names={names} />
        <Spinner game={game} names={names} />
        <div className="decks small muted">
          Action deck: {game.actionDeck} · Bonus deck: {game.bonusDeck}
        </div>
      </div>
    </section>
  );
}

export function CardImage({ id, big }: { id: number; big?: boolean }) {
  return <img className={`card-img ${big ? "big" : ""}`} src={cardSrc(id)} alt={cardAlt(id)} loading="lazy" />;
}

function Dice({ game, names }: { game: GameView; names: Map<string, string> }) {
  const roll = game.lastRoll;
  const key = useRollKey(roll ? `${roll.player}:${roll.dice.join(",")}:${game.log.length}` : "");
  if (!roll) return <div className="dice muted small">No dice rolled yet.</div>;
  return (
    <div className="dice">
      <div className="muted small">{names.get(roll.player)} rolled</div>
      <div className="dice-row" key={key}>
        {roll.dice.map((d, i) => (
          <span key={i} className="die" style={{ animationDelay: `${i * 60}ms` }}>
            {d >= 1 && d <= 6 ? "⚀⚁⚂⚃⚄⚅"[d - 1] : d}
          </span>
        ))}
      </div>
    </div>
  );
}

function useRollKey(sig: string) {
  const ref = useRef({ sig: "", n: 0 });
  if (ref.current.sig !== sig) ref.current = { sig, n: ref.current.n + 1 };
  return ref.current.n;
}

function Spinner({ game, names }: { game: GameView; names: Map<string, string> }) {
  const spin = game.lastSpin;
  const [turns, setTurns] = useState(0);
  const last = useRef<string>("");
  const sig = spin ? `${spin.player}:${spin.segment}:${game.log.length}` : "";
  useEffect(() => {
    if (spin && sig !== last.current) {
      last.current = sig;
      setTurns((t) => t + 1);
    }
  }, [sig, spin]);
  const seg = spin?.segment ?? 0;
  // Segment i spans 45i..45(i+1) degrees clockwise from 12 o'clock; rotate its middle under the pointer.
  const angle = turns * 1440 - (seg * 45 + 22.5);
  return (
    <div className="spinner-box">
      <div className="spinner-wheel" style={{ transform: `rotate(${angle}deg)` }}>
        <img src="/assets/spinner/standard.svg" alt="" />
      </div>
      <div className="spinner-pointer">▼</div>
      <div className="small muted spinner-caption">
        {spin ? `${names.get(spin.player)}: ${SPINNER[spin.segment].text.toLowerCase()}` : "Spinner"}
      </div>
    </div>
  );
}

function Players({ conn, game, room }: { conn: RoomConnection; game: GameView; room: RoomInfo }) {
  const online = new Map(room.players.map((p) => [p.id, p.connected]));
  const bots = new Set(room.players.filter((p) => p.bot).map((p) => p.id));
  return (
    <section className="panel players">
      {game.players.map((p) => {
        const curses = game.watchers.filter((w) => w.player === p.id);
        const status =
          p.pos.kind === "nebula"
            ? `In the NEBULA (${p.nebulaTurns})`
            : p.pos.kind === "start"
              ? "At START"
              : p.pos.kind === "finish"
                ? "FINISHED"
                : p.skipTurns
                  ? `Asleep (${p.skipTurns})`
                  : "";
        return (
          <div key={p.id} className={`player-row ${game.current === p.id ? "current" : ""} ${online.get(p.id) ? "" : "offline"}`}>
            <img src={`/assets/pawns/${p.pawn}.png`} alt="" />
            <div className="player-info">
              <div>
                <strong>{p.name}</strong>
                {p.id === conn.you && <span className="tag">you</span>}
                {bots.has(p.id) && <span className="tag">computer</span>}
                {!online.get(p.id) && <span className="tag">offline</span>}
              </div>
              <div className="small muted">
                {p.hand.length} Bonus card{p.hand.length === 1 ? "" : "s"}
                {status && ` · ${status}`}
              </div>
              {curses.map((w) => (
                <div key={w.id} className="curse small">
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

function Hand({ game, hand }: { game: GameView; hand: number[] }) {
  const playable = game.pending?.kind === "turn" ? game.pending.playable : [];
  if (hand.length === 0) return <section className="panel hand muted small">No Bonus cards yet. Land on a Bonus space to collect one.</section>;
  return (
    <section className="panel hand">
      <h3>Your Bonus cards</h3>
      <div className="hand-cards">
        {hand.map((c, i) => (
          <figure key={`${c}-${i}`} className={playable.includes(c) ? "playable" : ""}>
            <CardImage id={c} />
            <figcaption className="small">{PASSIVE_HINT[c] ?? (playable.includes(c) ? "Play it from the turn menu." : CARD_TEXT.get(c)?.title)}</figcaption>
          </figure>
        ))}
      </div>
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
  const hasMyTurn = me?.hand.includes(99);
  return (
    <section className="panel chat">
      <h3>Chat</h3>
      <div className="chat-list" ref={list}>
        {chat.map((m) => (
          <div key={m.id} className={`chat-msg ${m.player === null ? "system" : ""}`}>
            <strong>{m.name}:</strong> {m.text}
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
  const entries = game.log.slice(-40).reverse();
  return (
    <section className="panel log">
      <h3>What happened</h3>
      <ol>
        {entries.map((e) => (
          <li key={e.n} className="small">
            {e.card && <span className="tag">{e.card.deck}</span>}
            {e.text}
            {e.card && e.text.indexOf(cardTitle(e.card.id)) === -1 ? "" : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
