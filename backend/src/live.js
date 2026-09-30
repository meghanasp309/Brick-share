// Live updates with Socket.io (WebSockets), like a stock app.
//
// The app connects to the same address as the API (http://localhost:4000).
//  - To watch one property's market:  socket.emit("watch", propertyId)
//    You then get "orderbook", "trade" and "ticker" events for it.
//  - To get your own updates, connect with your login token:
//      io("http://localhost:4000", { auth: { token } })
//    You then get "order" (your order changed), "trade" (your trade changed)
//    and "wallet" (your rupee balance changed).
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const config = require("./config");

let io = null;

/** Starts Socket.io on the running HTTP server. */
function attach(httpServer) {
  io = new Server(httpServer, { cors: { origin: "*" } });
  io.on("connection", (socket) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        socket.join(`user:${jwt.verify(token, config.jwtSecret).sub}`);
      } catch {
        socket.emit("error-message", "Your login has expired. Please log in again");
      }
    }
    socket.on("watch", (propertyId) => {
      const id = Number(propertyId);
      if (Number.isInteger(id) && id > 0) socket.join(`property:${id}`);
    });
    socket.on("unwatch", (propertyId) => socket.leave(`property:${Number(propertyId)}`));
  });
  return io;
}

/** Sends to everyone watching a property. Does nothing if Socket.io isn't running (tests). */
const toProperty = (propertyId, event, data) => io?.to(`property:${propertyId}`).emit(event, data);

/** Sends to one logged-in user (all their open apps). */
const toUser = (userId, event, data) => io?.to(`user:${userId}`).emit(event, data);

function close() {
  io?.close();
  io = null;
}

module.exports = { attach, toProperty, toUser, close };
