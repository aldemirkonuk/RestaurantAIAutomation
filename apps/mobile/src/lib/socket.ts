import { io, Socket } from "socket.io-client";
import { SOCKET_URL } from "@/config";
import { queryClient } from "@/lib/queryClient";
import { useOutbox } from "@/state/outbox";
import { invalidationsFor, LIVE_EVENTS, socketUrl } from "@/lib/socketEvents";

let socket: Socket | null = null;
let currentToken: string | null = null;

/** Observable connection state, for the "Live"/"Polling" affordance. */
export type LiveStatus = "offline" | "connecting" | "live";
let status: LiveStatus = "offline";
const listeners = new Set<(s: LiveStatus) => void>();

function setStatus(next: LiveStatus): void {
  if (status === next) return;
  status = next;
  for (const fn of listeners) fn(next);
}

export function getLiveStatus(): LiveStatus {
  return status;
}

export function onLiveStatus(fn: (s: LiveStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Live channel: the gateway verifies the JWT in the handshake
 * (`websocket.gateway.ts:682` reads `handshake.auth.token`) and joins the
 * user/restaurant rooms server-side. Anything that changes the decision
 * surface invalidates the feed, so an approval handled on web disappears
 * from the phone within a beat.
 *
 * Reconnecting with the same token is a no-op; a *different* token (post
 * refresh) tears the old pipe down first, because the gateway derives room
 * membership from the token at handshake time and will not re-derive it.
 */
export function connectSocket(token: string): void {
  if (socket && currentToken === token && (socket.connected || socket.active)) {
    return;
  }
  disconnectSocket();
  currentToken = token;
  setStatus("connecting");

  socket = io(socketUrl(SOCKET_URL), {
    transports: ["websocket"],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  socket.on("connect", () => {
    setStatus("live");
    // A live pipe also means queued actions can drain.
    useOutbox.getState().flush();
    // The socket was down for an unknown span; assume everything is stale.
    queryClient.invalidateQueries();
  });

  socket.on("disconnect", () => setStatus("offline"));
  socket.on("connect_error", () => setStatus("offline"));

  for (const event of LIVE_EVENTS) {
    socket.on(event, () => {
      for (const queryKey of invalidationsFor(event)) {
        queryClient.invalidateQueries({ queryKey });
      }
    });
  }
}

export function disconnectSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  currentToken = null;
  setStatus("offline");
}
