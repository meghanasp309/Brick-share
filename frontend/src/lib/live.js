// Live updates from the backend with Socket.io, like a stock app.
import { io } from "socket.io-client";
import { API_URL, getToken } from "./api";

let socket = null;

/** One shared connection. Logged-in users also get their own updates (wallet, orders). */
export function getSocket() {
  if (!socket) socket = io(API_URL, { auth: { token: getToken() || undefined } });
  return socket;
}

/** Call after login or logout, so the connection uses the new token. */
export function resetSocket() {
  socket?.disconnect();
  socket = null;
}
