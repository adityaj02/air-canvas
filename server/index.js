const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");

const app = express();
app.use(cors());

const server = http.createServer(app);

/* =========================
   PEER SERVER
========================= */
const peerServer = ExpressPeerServer(server, {
  debug: false,
  path: "/",
  proxied: true,
  allow_discovery: true,
});
app.use("/peerjs", peerServer);

/* =========================
   SOCKET.IO SERVER
========================= */
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"],
    credentials: false
  },
  transports: ["websocket", "polling"],
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

const rooms = new Map();
const users = new Map();

io.on("connection", (socket) => {
  console.log(`🔗 User Connected: ${socket.id}`);
  users.set(socket.id, { connectedAt: new Date() });

  socket.on("join_room", (data) => {
    const roomId = data.room || data;
    const peerId = data.peerId;

    if (!roomId) return;

    if (socket.data.room) {
      socket.leave(socket.data.room);
    }

    socket.join(roomId);
    socket.data.room = roomId;
    socket.data.peerId = peerId;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    socket.to(roomId).emit("user_connected", peerId);
  });

  socket.on("draw_line", (data) => {
    const { room, x1, y1, x2, y2, color } = data;
    if (room) {
      socket.to(room).emit("receive_draw", {
        x1, y1, x2, y2, color,
        from: socket.id
      });
    }
  });

  socket.on("clear_canvas", (data) => {
    const roomId = data.room || socket.data.room;
    if (roomId) {
      socket.to(roomId).emit("clear_canvas", { from: socket.id });
    }
  });

  socket.on("disconnect", () => {
    const userRoom = socket.data.room;
    if (userRoom && rooms.has(userRoom)) {
      const roomUsers = rooms.get(userRoom);
      roomUsers.delete(socket.id);
      if (roomUsers.size === 0) {
        rooms.delete(userRoom);
      } else {
        socket.to(userRoom).emit("user_disconnected", {
          peerId: socket.data.peerId
        });
      }
    }
    users.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
});