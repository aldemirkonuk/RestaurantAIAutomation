import { io, Socket } from "socket.io-client";
import { SOCKET_URL } from "@/config";
import { queryClient } from "@/lib/queryClient";
import { feedKey, pulseKey } from "@/api/queries";
import { useOutbox } from "@/state/outbox";

let socket: Socket | null = null;

/**
 * Live channel: the gateway verifies the JWT in the handshake and joins the
 * user/restaurant rooms server-side. Anything that changes the decision
 * surface invalidates the feed, so an approval handled on web disappears
 * from the phone within a beat.
 */
export function connectSocket(token: string): void {
  if (socket?.connected) return;
  disconnectSocket();

  socket = io(SOCKET_URL, {
    transports: ["websocket"],
    auth: { token },
  });

  socket.on("connect", () => {
    // A live pipe also means queued actions can drain.
    useOutbox.getState().flush();
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [...feedKey] });
    queryClient.invalidateQueries({ queryKey: [...pulseKey] });
  };

  socket.on("notification:new", refresh);
  socket.on("order:updated", refresh);
  socket.on("order_change", refresh);
}

export function disconnectSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
