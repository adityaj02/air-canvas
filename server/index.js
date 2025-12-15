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
  debug: true,
  path: "/",
});
app.use("/peerjs", peerServer);

/* =========================
   SOCKET.IO SERVER
========================= */
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  perMessageDeflate: false,
});

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  /* =========================
     JOIN ROOM
  ========================= */
  socket.on("join_room", (data) => {
    const roomId = data.room || data;
    const peerId = data.peerId;

    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);

    if (peerId) {
      socket.to(roomId).emit("user_connected", peerId);
    }
  });

  /* =========================
     DRAW LINE (FIXED)
     ❌ volatile removed
  ========================= */
  socket.on("draw_line", (data) => {
    socket.to(data.room).emit("receive_draw", data);
  });

  /* =========================
     CLEAR CANVAS
  ========================= */
  socket.on("clear_canvas", (room) => {
    socket.to(room).emit("clear_canvas");
  });

  socket.on("disconnect", () => {
    console.log(`User Disconnected: ${socket.id}`);
  });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
