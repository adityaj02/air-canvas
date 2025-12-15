const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");

const app = express();
app.use(cors());

const server = http.createServer(app);

/* =========================================
        PEER SERVER
========================================= */
const peerServer = ExpressPeerServer(server, {
  debug: false,
  path: "/",   // you can switch to "/peerjs" if needed
  proxied: true,
  allow_discovery: true,
});

app.use("/peerjs", peerServer);

/* =========================================
        SOCKET.IO SERVER
========================================= */
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false,
  },
  transports: ["websocket", "polling"],
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log(`🔗 User Connected: ${socket.id}`);

  socket.on("join_room", ({ room, peerId }) => {
    if (!room) return;

    // Leave old room if already joined one
    if (socket.data.room) socket.leave(socket.data.room);

    socket.join(room);
    socket.data.room = room;
    socket.data.peerId = peerId;

    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socket.id);

    socket.to(room).emit("user_connected", peerId);
  });

  /* =========================================
        DRAW EVENTS
  ========================================== */
  socket.on("draw_line", (data) => {
    const { room } = data;
    if (room) {
      socket.to(room).emit("receive_draw", {
        ...data,
        from: socket.id,
      });
    }
  });

  socket.on("clear_canvas", ({ room }) => {
    socket.to(room).emit("clear_canvas");
  });

  /* =========================================
        DISCONNECT HANDLING
  ========================================== */
  socket.on("disconnect", () => {
    const room = socket.data.room;

    if (room && rooms.has(room)) {
      const set = rooms.get(room);
      set.delete(socket.id);

      if (set.size === 0) rooms.delete(room);

      socket.to(room).emit("user_disconnected", {
        peerId: socket.data.peerId,
      });
    }

    console.log(`❌ User Disconnected: ${socket.id}`);
  });
});

/* =========================================
        START SERVER
========================================= */
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
});
