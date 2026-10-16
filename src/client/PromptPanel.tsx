import { useEffect, useState } from "react";
import type { GameView } from "../engine/game";
import type { Answer } from "../engine/types";
import { promptPlayers } from "../engine/bot";
import { cardTitle } from "./cards";
import { CardImage } from "./GameScreen";
import type { RoomConnection } from "./useRoom";

interface Props {
  conn: RoomConnection;
  game: GameView;
  names: Map<string, string>;
}

/** Shows whatever the game is waiting for: your buttons if it's waiting on you, otherwise who it's waiting on. */
export function PromptPanel({ conn, game, names }: Props) {
  const p = game.pending;
  const [sentFor, setSentFor] = useState<number | null>(null);
  const [since, setSince] = useState(Date.now());
  useEffect(() => {
    setSince(Date.now());
    setSentFor(null);
  }, [p?.id]);
  if (!p) return <section className="panel prompt muted">…</section>;

  const waitingOn = promptPlayers(p);
  const mine = !!conn.you && waitingOn.includes(conn.you);
  const answer = (a: Answer) => {
    setSentFor(p.id);
    conn.send({ t: "answer", promptId: p.id, answer: a });
  };
  const who = waitingOn.map((id) => names.get(id)).join(", ");
  const header = (
    <>
      {p.title && <div className="prompt-title">{p.title}</div>}
      <p className="prompt-text">{p.text}</p>
    </>
  );

  if (!mine) {
    const extra =
      p.kind === "vote" ? ` (${Object.keys(p.votes).length}/${p.voters.length} voted)` : p.kind === "timer" ? "" : "";
    return (
      <section className="panel prompt waiting">
        {header}
        <p className="muted">
          Waiting for {who}
          {extra}…
        </p>
        {p.kind === "timer" && <Countdown key={p.id} seconds={p.seconds} />}
        {p.kind === "race" && <DiceList dice={p.dice} />}
        {conn.you && <Nudge since={since} onNudge={() => conn.send({ t: "nudge" })} />}
      </section>
    );
  }

  const busy = sentFor === p.id && p.kind !== "vote" && p.kind !== "race";
  return (
    <section className={`panel prompt yours ${busy ? "busy" : ""}`}>
      <div className="your-move">Your move!</div>
      {header}
      {p.kind === "turn" && (
        <div className="btn-row">
          <button className="btn big" onClick={() => answer({ action: "draw" })} disabled={busy}>
            {p.title === "Grappling Hook" ? "Roll for the win" : "Draw an Action card"}
          </button>
          {p.playable.map((c) => (
            <button key={c} className="btn play-card" onClick={() => answer({ action: "play", card: c })} disabled={busy}>
              <CardImage id={c} />
              <span>Play {cardTitle(c)}</span>
            </button>
          ))}
        </div>
      )}
      {p.kind === "choose" && (
        <div className="btn-row">
          {p.options.map((o) => (
            <button key={o.id} className="btn" onClick={() => answer({ choice: o.id })} disabled={busy}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {p.kind === "roll" && (
        <button className="btn big" onClick={() => answer({})} disabled={busy}>
          🎲 Roll {p.dice === 1 ? "the die" : `${p.dice} dice`}
        </button>
      )}
      {p.kind === "spin" && (
        <button className="btn big" onClick={() => answer({})} disabled={busy}>
          🌀 Spin{p.mode === "color" ? " (color only)" : ""}
        </button>
      )}
      {p.kind === "pickPlayer" && (
        <div className="btn-row">
          {p.candidates.map((c) => (
            <button key={c} className="btn" onClick={() => answer({ target: c })} disabled={busy}>
              {names.get(c)}
            </button>
          ))}
        </div>
      )}
      {p.kind === "pickSpace" && <p className="muted small">Tap a glowing space on the board.</p>}
      {p.kind === "vote" && (
        <div className="btn-row">
          {p.options.map((o) => (
            <button
              key={o.id}
              className={`btn ${conn.you && p.votes[conn.you] === o.id ? "chosen" : ""}`}
              onClick={() => answer({ choice: o.id })}
              disabled={!!(conn.you && p.votes[conn.you])}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {p.kind === "race" && <Race key={p.id} dice={p.dice} onAnswer={(n) => answer({ answer: n })} />}
      {p.kind === "timer" && (
        <>
          <Countdown key={p.id} seconds={p.seconds} />
          {p.player === conn.you && (
            <button className="btn big" onClick={() => answer({ done: true })} disabled={busy}>
              Done
            </button>
          )}
        </>
      )}
      {p.kind === "react" && (
        <div className="btn-row">
          {p.cards.map((c) => (
            <button key={c} className="btn play-card" onClick={() => answer({ card: c })} disabled={busy}>
              <CardImage id={c} />
              <span>Play {cardTitle(c)}</span>
            </button>
          ))}
          <button className="btn secondary" onClick={() => answer({ card: null })} disabled={busy}>
            No thanks
          </button>
        </div>
      )}
      {p.kind === "text" && <TextAnswer key={p.id} max={p.maxLength} onAnswer={(text) => answer({ text })} />}
    </section>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const end = Date.now() + seconds * 1000;
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [seconds]);
  return <div className={`countdown ${left <= 5 ? "low" : ""}`}>{left}s</div>;
}

function DiceList({ dice }: { dice: number[] }) {
  return (
    <div className="dice-row">
      {dice.map((d, i) => (
        <span key={i} className="die">
          {"⚀⚁⚂⚃⚄⚅"[d - 1] ?? d}
        </span>
      ))}
    </div>
  );
}

function Race({ dice, onAnswer }: { dice: number[]; onAnswer: (n: number) => void }) {
  const [v, setV] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!v) return;
        setSent(true);
        onAnswer(Number(v));
      }}
    >
      <DiceList dice={dice} />
      <div className="join-row">
        <input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} placeholder="Sum" autoFocus aria-label="Sum of the dice" disabled={sent} />
        <button className="btn" type="submit" disabled={sent || !v}>
          {sent ? "Sent" : "Answer"}
        </button>
      </div>
    </form>
  );
}

function TextAnswer({ max, onAnswer }: { max: number; onAnswer: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="join-row"
      onSubmit={(e) => {
        e.preventDefault();
        onAnswer(v.trim());
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} maxLength={max} autoFocus aria-label="Your answer" />
      <button className="btn" type="submit">
        Send
      </button>
    </form>
  );
}

/** After a while, anyone can let the computer answer for a player who wandered off. */
function Nudge({ since, onNudge }: { since: number; onNudge: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now - since < 45_000) return null;
  return (
    <button className="btn tiny secondary" onClick={onNudge}>
      Taking too long? Let the computer choose for them
    </button>
  );
}
