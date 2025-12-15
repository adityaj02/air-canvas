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
  debug: false, // Changed to false for production
  path: "/",
  proxied: true, // Important for Render deployment
  allow_discovery: true,
});
app.use("/peerjs", peerServer);

/* =========================
   SOCKET.IO SERVER
========================= */
const io = new Server(server, {
  cors: {
    origin: "*", // In production, specify your frontend URL
    methods: ["GET", "POST"],
    credentials: false
  },
  transports: ["websocket", "polling"],
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

// Store active rooms and users
const rooms = new Map();
const users = new Map();

io.on("connection", (socket) => {
  console.log(`🔗 User Connected: ${socket.id}`);
  users.set(socket.id, { connectedAt: new Date() });

  /* =========================
     JOIN ROOM
  ========================= */
  socket.on("join_room", (data) => {
    const roomId = data.room || data;
    const peerId = data.peerId;

    if (!roomId) {
      socket.emit("error", { message: "Room ID is required" });
      return;
    }

    // Leave any previous room
    if (socket.data.room) {
      socket.leave(socket.data.room);
    }

    // Join new room
    socket.join(roomId);
    socket.data.room = roomId;
    socket.data.peerId = peerId;

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    console.log(`📥 User ${socket.id} joined room: ${roomId} (Peer: ${peerId})`);
    console.log(`👥 Room ${roomId} now has ${rooms.get(roomId).size} users`);

    // Notify others in the room about new user
    socket.to(roomId).emit("user_connected", peerId);

    // Send confirmation to the joining user
    const usersInRoom = Array.from(rooms.get(roomId)).length;
    socket.emit("room_joined", {
      room: roomId,
      peerId: peerId,
      userCount: usersInRoom
    });
  });

  /* =========================
     DRAW LINE
  ========================= */
  socket.on("draw_line", (data) => {
    const { room, x1, y1, x2, y2, color } = data;
    
    if (!room) {
      console.error("❌ No room specified in draw_line");
      return;
    }

    // Validate data
    if (typeof x1 !== 'number' || typeof y1 !== 'number' || 
        typeof x2 !== 'number' || typeof y2 !== 'number') {
      console.error("❌ Invalid coordinates in draw_line");
      return;
    }

    console.log(`🎨 Drawing in room ${room}: (${x1},${y1}) -> (${x2},${y2}) color:${color}`);
    
    // Broadcast to all other users in the room
    socket.to(room).emit("receive_draw", {
      x1, y1, x2, y2, color,
      timestamp: Date.now(),
      from: socket.id
    });
  });

  /* =========================
     CLEAR CANVAS
  ========================= */
  socket.on("clear_canvas", (data) => {
    const roomId = data.room || socket.data.room;
    
    if (!roomId) {
      console.error("❌ No room specified for clear_canvas");
      return;
    }

    console.log(`🧹 Clear canvas requested for room: ${roomId} by ${socket.id}`);
    
    // Broadcast clear command to all other users in the room
    socket.to(roomId).emit("clear_canvas", {
      from: socket.id,
      timestamp: Date.now()
    });
  });

  /* =========================
     HEARTBEAT/PING
  ========================= */
  socket.on("ping", () => {
    socket.emit("pong", { timestamp: Date.now() });
  });

  /* =========================
     DISCONNECT
  ========================= */
  socket.on("disconnect", (reason) => {
    console.log(`🔌 User Disconnected: ${socket.id} (Reason: ${reason})`);
    
    const userRoom = socket.data.room;
    if (userRoom && rooms.has(userRoom)) {
      const roomUsers = rooms.get(userRoom);
      roomUsers.delete(socket.id);
      
      console.log(`👋 User ${socket.id} left room ${userRoom}`);
      console.log(`👥 Room ${userRoom} now has ${roomUsers.size} users`);
      
      // Clean up empty rooms
      if (roomUsers.size === 0) {
        rooms.delete(userRoom);
        console.log(`🗑️ Room ${userRoom} deleted (empty)`);
      } else {
        // Notify others in the room about disconnection
        socket.to(userRoom).emit("user_disconnected", {
          peerId: socket.data.peerId,
          userId: socket.id
        });
      }
    }
    
    users.delete(socket.id);
  });

  /* =========================
     ERROR HANDLING
  ========================= */
  socket.on("error", (error) => {
    console.error(`❌ Socket error from ${socket.id}:`, error);
  });
});

/* =========================
   HEALTH CHECK ENDPOINT
========================= */
app.get("/health", (req, res) => {
  const serverStatus = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rooms: Array.from(rooms.keys()).length,
    totalUsers: users.size,
    activeConnections: io.engine.clientsCount
  };
  
  res.json(serverStatus);
});

/* =========================
   ROOM STATISTICS ENDPOINT
========================= */
app.get("/stats", (req, res) => {
  const stats = {
    totalRooms: rooms.size,
    totalUsers: users.size,
    rooms: Array.from(rooms.entries()).map(([roomId, usersSet]) => ({
      roomId,
      userCount: usersSet.size,
      users: Array.from(usersSet)
    })),
    timestamp: new Date().toISOString()
  };
  
  res.json(stats);
});

/* =========================
   PEER SERVER HEALTH CHECK
========================= */
app.get("/peerjs/health", (req, res) => {
  res.json({
    status: "peerjs_running",
    path: "/peerjs",
    timestamp: new Date().toISOString()
  });
});

/* =========================
   ROOT ENDPOINT
========================= */
app.get("/", (req, res) => {
  res.json({
    service: "Air Canvas Backend",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      stats: "/stats",
      peerjs: "/peerjs",
      peerjsHealth: "/peerjs/health"
    },
    documentation: "WebSocket server for real-time collaborative drawing"
  });
});

/* =========================
   ERROR HANDLING MIDDLEWARE
========================= */
app.use((err, req, res, next) => {
  console.error("Server Error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined
  });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`🚀 SERVER RUNNING ON http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket server ready for connections`);
  console.log(`🤝 PeerJS server available at /peerjs`);
  console.log(`🏥 Health check at /health`);
});

/* =========================
   GRACEFUL SHUTDOWN
========================= */
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server gracefully...");
  
  // Close all connections
  io.close(() => {
    console.log("📡 Socket.io server closed");
    server.close(() => {
      console.log("🌐 HTTP server closed");
      process.exit(0);
    });
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.log("⏰ Force shutdown after timeout");
    process.exit(1);
  }, 10000);
});

// Log server events
server.on("listening", () => {
  console.log(`✅ Server successfully bound to port ${PORT}`);
});

server.on("error", (error) => {
  console.error("❌ Server error:", error);
  process.exit(1);
});