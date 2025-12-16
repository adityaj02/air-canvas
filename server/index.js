/**
 * Air Canvas Backend
 * Integration: Express + Socket.io + PeerJS
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");

// Initialize App
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

/* =========================================
       HEALTH CHECK (Crucial for Deployment)
========================================= */
app.get("/", (req, res) => {
  res.send("Air Canvas Server is Running 🚀");
});

/* =========================================
       PEER SERVER CONFIG
========================================= */
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: "/",
  proxied: true,        // Crucial for Render/Heroku deployments
  allow_discovery: true,
});

app.use("/peerjs", peerServer);

/* =========================================
       SOCKET.IO SERVER CONFIG
========================================= */
const io = new Server(server, {
  cors: {
    origin: "*",        // Update this to your frontend URL in production
    methods: ["GET", "POST"],
    credentials: false,
  },
  transports: ["websocket", "polling"],
});

// In-memory store for room tracking (Consider Redis for scaling later)
const rooms = new Map();

io.on("connection", (socket) => {
  console.log(`🔗 User Connected: ${socket.id}`);

  // --- JOIN ROOM ---
  socket.on("join_room", ({ room, peerId }) => {
    if (!room) return;

    // Leave previous room if exists
    if (socket.data.room) {
      socket.leave(socket.data.room);
    }

    socket.join(room);
    socket.data.room = room;
    socket.data.peerId = peerId;

    // Track room occupancy
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socket.id);

    // Notify others in the room (Video Call Trigger)
    socket.to(room).emit("user_connected", peerId);
    
    console.log(`User ${socket.id} joined room: ${room} with PeerID: ${peerId}`);
  });

  // --- DRAWING EVENTS ---
  socket.on("draw_line", (data) => {
    const { room } = data;
    if (room) {
      // Broadcast to everyone else in the room
      socket.to(room).emit("receive_draw", {
        ...data,
        from: socket.id,
      });
    }
  });

  socket.on("clear_canvas", ({ room }) => {
    if (room) {
      socket.to(room).emit("clear_canvas");
    }
  });

  // --- DISCONNECT HANDLING ---
  socket.on("disconnect", () => {
    const room = socket.data.room;

    if (room && rooms.has(room)) {
      const set = rooms.get(room);
      set.delete(socket.id);

      if (set.size === 0) {
        rooms.delete(room);
      } else {
        // Only emit if there are people left to hear it
        socket.to(room).emit("user_disconnected", {
          peerId: socket.data.peerId,
        });
      }
    }
    console.log(`❌ User Disconnected: ${socket.id}`);
  });
});

/* =========================================
       START SERVER
========================================= */
server.listen(PORT, () => {
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
});