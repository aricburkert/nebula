export { Room } from "./room";

interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

// No 0/O/1/I so codes are easy to read out loud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return Response.json({ code: newCode() });
    }
    const m = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\/ws$/);
    if (m) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(new Request(`https://room/${m[1]}`, request));
    }
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
