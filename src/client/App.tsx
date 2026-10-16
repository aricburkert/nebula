import { useEffect, useState } from "react";
import { Lobby } from "./Lobby";
import { GameScreen } from "./GameScreen";
import { useRoom } from "./useRoom";

function roomFromPath(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{5})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

export function App() {
  const [code, setCode] = useState(roomFromPath);
  useEffect(() => {
    const onPop = () => setCode(roomFromPath());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = (c: string) => {
    history.pushState(null, "", `/r/${c}`);
    setCode(c);
  };
  return code ? <Room code={code} /> : <Home onGo={go} />;
}

function Home({ onGo }: { onGo: (code: string) => void }) {
  const [join, setJoin] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/rooms", { method: "POST" });
      const { code } = (await r.json()) as { code: string };
      onGo(code);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="home">
      <h1 className="logo">
        <span className="logo-the">The</span>
        <span className="logo-nebula">Nebula</span>
        <span className="logo-from">from</span>
        <span className="logo-hell">Hell</span>
      </h1>
      <p className="tagline">The party game for sarcastic people who enjoy making fun of others. Now online.</p>
      <div className="home-actions panel">
        <button className="btn big" onClick={create} disabled={busy}>
          Create a room
        </button>
        <div className="or">or join one</div>
        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^[A-Za-z0-9]{5}$/.test(join)) onGo(join.toUpperCase());
          }}
        >
          <input
            value={join}
            onChange={(e) => setJoin(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={5}
            aria-label="Room code"
          />
          <button className="btn" type="submit" disabled={join.length !== 5}>
            Join
          </button>
        </form>
      </div>
      <p className="small muted">2 to 6 players. Send your friends the room link and race to FINISH.</p>
    </main>
  );
}

function Room({ code }: { code: string }) {
  const conn = useRoom(code);
  const { room, game, error, clearError } = conn;
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error, clearError]);
  return (
    <>
      {!room ? (
        <main className="home">
          <p>{conn.status === "closed" ? "Reconnecting…" : "Connecting…"}</p>
        </main>
      ) : room.phase === "lobby" || !game ? (
        <Lobby conn={conn} room={room} />
      ) : (
        <GameScreen conn={conn} room={room} game={game} />
      )}
      {error && (
        <div className="toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
      {conn.status === "closed" && room && <div className="toast warn">Connection lost. Reconnecting…</div>}
    </>
  );
}
