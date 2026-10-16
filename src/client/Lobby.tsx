import { useState } from "react";
import { BOARDS, MAX_PLAYERS, pawnOnBoard, pawnsFor, type RoomInfo } from "../shared/protocol";
import type { RoomConnection } from "./useRoom";
import { WorldLayer } from "./WorldLayer";

export function Lobby({ conn, room }: { conn: RoomConnection; room: RoomInfo }) {
  const me = room.players.find((p) => p.id === conn.you);
  const isHost = room.host === conn.you;
  const taken = new Set(room.players.map((p) => p.pawn));
  const [name, setName] = useState("");
  const [pawn, setPawn] = useState<string | null>(null);
  const link = `${location.origin}/r/${room.code}`;
  const [copied, setCopied] = useState(false);

  const board = room.settings.board;
  const pick = (id: string) => {
    if (me) conn.send({ t: "pawn", pawn: id });
    else setPawn(id);
  };
  // If the host switches boards before you join, your pick becomes the same character in the other edition.
  const chosen = pawn && pawnOnBoard(pawn, board);
  const selected = me?.pawn ?? chosen;

  return (
    <main className="lobby">
      <WorldLayer mode="lobby" board={board} pawns={room.players.map((p) => ({ id: p.id, pawn: p.pawn, name: p.name }))} />
      <h1 className="logo small-logo">
        <img className="lobby-logo" src="/assets/logo/title.webp" alt="The Nebula from Hell" />
        <span className="lobby-word">Lobby</span>
      </h1>
      <section className="panel-glass">
        <div className="share">
          <div>
            <div className="muted small">Room code</div>
            <div className="code">{room.code}</div>
          </div>
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                prompt("Copy this link", link);
              }
            }}
          >
            {copied ? "Copied!" : "Copy invite link"}
          </button>
        </div>
      </section>

      {room.phase !== "lobby" && !me && <p className="panel-glass">This game has already started. You're watching.</p>}

      <section className="panel-glass">
        <h2>{me ? "Pick your pawn" : "Join the game"}</h2>
        {!me && room.phase === "lobby" && (
          <input className="name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={20} aria-label="Your name" />
        )}
        <div className="pawn-grid">
          {pawnsFor(board).map((p) => {
            const owner = room.players.find((x) => x.pawn === p.id);
            const disabled = !!owner && owner.id !== conn.you;
            return (
              <button
                key={p.id}
                className={`pawn-pick ${selected === p.id ? "selected" : ""}`}
                disabled={disabled || room.phase !== "lobby"}
                onClick={() => pick(p.id)}
                title={owner ? `${p.name} (${owner.name})` : p.name}
              >
                <img src={`/assets/pawns/${p.id}.png`} alt="" />
                <span>{owner ? owner.name : p.name}</span>
              </button>
            );
          })}
        </div>
        {!me && room.phase === "lobby" && (
          <button
            className="btn big"
            disabled={!name.trim() || !chosen || taken.has(chosen) || room.players.length >= MAX_PLAYERS}
            onClick={() => chosen && conn.send({ t: "join", name: name.trim(), pawn: chosen })}
          >
            {room.players.length >= MAX_PLAYERS ? "Room is full" : "Join"}
          </button>
        )}
      </section>

      <section className="panel-glass">
        <h2>
          Players <span className="muted small">({room.players.length}/{MAX_PLAYERS})</span>
        </h2>
        <ul className="lobby-players">
          {room.players.map((p) => (
            <li key={p.id} className={p.connected ? "" : "offline"}>
              <img src={`/assets/pawns/${p.pawn}.png`} alt="" />
              {p.name}
              {p.id === room.host && <span className="tag">host</span>}
              {p.id === conn.you && <span className="tag">you</span>}
              {p.bot && <span className="tag">computer</span>}
              {!p.connected && <span className="tag">offline</span>}
              {p.bot && isHost && room.phase === "lobby" && (
                <button className="btn tiny secondary" onClick={() => conn.send({ t: "removeBot", player: p.id })} aria-label={`Remove ${p.name}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {room.players.length === 0 && <li className="muted">Nobody yet.</li>}
        </ul>
        {isHost && room.phase === "lobby" && room.players.length < MAX_PLAYERS && (
          <button className="btn secondary" onClick={() => conn.send({ t: "addBot" })}>
            Add a computer player
          </button>
        )}
      </section>

      <section className="panel-glass">
        <h2>Settings</h2>
        <div className="board-pick" role="radiogroup" aria-label="Board">
          {BOARDS.map((b) => (
            <button
              key={b.id}
              role="radio"
              aria-checked={board === b.id}
              className={`board-card ${board === b.id ? "on" : ""}`}
              disabled={!isHost || room.phase !== "lobby"}
              onClick={() => board !== b.id && conn.send({ t: "settings", board: b.id })}
            >
              <img src={`/assets/board/${b.id}-thumb.jpg`} alt="" />
              <span>{b.name}</span>
            </button>
          ))}
        </div>
        <p className="muted small board-note">
          {isHost ? "Pick the board you'll play on. " : "The host picks the board. "}
          Same spaces and rules; Deep Space is the whole game set in outer space, with its own pawns.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={room.settings.videoCall}
            disabled={!isHost}
            onChange={(e) => conn.send({ t: "settings", videoCall: e.target.checked })}
          />
          <span>
            <strong>We're on a video call</strong>
            <br />
            <span className="muted small">
              Adds the 14 cards you need to see each other for (dance-offs, staring contests, burping…). Use any video call app alongside the game.
            </span>
          </span>
        </label>
        {isHost ? (
          <button className="btn big start" disabled={room.players.length < 2} onClick={() => conn.send({ t: "start" })}>
            {room.players.length < 2 ? "Waiting for at least 2 players" : "Start the game"}
          </button>
        ) : (
          <p className="muted">Waiting for the host to start the game.</p>
        )}
      </section>
    </main>
  );
}
