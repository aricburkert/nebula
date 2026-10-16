import { useCallback, useEffect, useRef, useState } from "react";
import type { GameView } from "../engine/game";
import type { ChatMessage, ClientMsg, RoomInfo, ServerMsg } from "../shared/protocol";

const tokenKey = (code: string) => `nebula:token:${code}`;

function readToken(code: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(code: string, token: string) {
  try {
    localStorage.setItem(tokenKey(code), token);
  } catch {
    // private mode: the player just can't rejoin after a reload
  }
}

export interface RoomConnection {
  status: "connecting" | "open" | "closed";
  you: string | null;
  room: RoomInfo | null;
  game: GameView | null;
  chat: ChatMessage[];
  error: string | null;
  send: (msg: ClientMsg) => void;
  clearError: () => void;
}

/** Keeps a WebSocket to the room open (reconnecting as needed) and holds what the server last sent. */
export function useRoom(code: string): RoomConnection {
  const [status, setStatus] = useState<RoomConnection["status"]>("connecting");
  const [you, setYou] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
      wsRef.current = ws;
      setStatus("connecting");
      ws.onopen = () => {
        retry = 0;
        setStatus("open");
        ws.send(JSON.stringify({ t: "hello", token: readToken(code) } satisfies ClientMsg));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMsg;
        switch (msg.t) {
          case "welcome":
            setYou(msg.you);
            if (msg.token) writeToken(code, msg.token);
            break;
          case "room":
            setRoom(msg.room);
            break;
          case "state":
            setGame(msg.game);
            break;
          case "chat":
            setChat((c) => {
              const seen = new Set(c.map((m) => m.id));
              return [...c, ...msg.messages.filter((m) => !seen.has(m.id))].slice(-150);
            });
            break;
          case "error":
            setError(msg.error);
            break;
        }
      };
      ws.onclose = () => {
        setStatus("closed");
        if (closed) return;
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [code]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { status, you, room, game, chat, error, send, clearError: () => setError(null) };
}
