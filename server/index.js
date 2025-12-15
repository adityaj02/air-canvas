const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");

const app = express();
app.use(cors());

const server = http.createServer(app);

// SETUP PEER SERVER
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: "/"
});
app.use("/peerjs", peerServer);

const io = new Server(server, {
  cors: {
    origin: "*", // CRITICAL FIX: Allows Vercel (or any site) to connect
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"], // Added polling as backup for better stability
  perMessageDeflate: false
});

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // JOIN ROOM WITH PEER ID
  socket.on("join_room", (data) => {
    // Handle both formats: simple string or object {room, peerId}
    const roomId = data.room || data; 
    const peerId = data.peerId;

    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);
    
    // Broadcast to others that a new user connected (for video call)
    if (peerId) {
        socket.to(roomId).emit("user_connected", peerId);
    }
  });

  socket.on("draw_line", (data) => {
    // Using volatile for drawing prevents lag if network is slow
    socket.to(data.room).volatile.emit("receive_draw", data);
  });

  socket.on("clear_canvas", (room) => {
    socket.to(room).emit("clear_canvas");
  });
});

// CRITICAL FIX: Use Render's port if available, otherwise 3001
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});