const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { ExpressPeerServer } = require("peer"); // Add Peer Server

const app = express();
app.use(cors());

const server = http.createServer(app);

// SETUP PEER SERVER
const peerServer = ExpressPeerServer(server, {
  debug: true,
});
app.use("/peerjs", peerServer);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
  perMessageDeflate: false
});

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // JOIN ROOM WITH PEER ID
  socket.on("join_room", (data) => {
    // data might be string (old) or object (new: {room, peerId})
    const roomId = data.room || data; 
    const peerId = data.peerId;

    socket.join(roomId);
    
    // Broadcast to others that a new user connected (so they can call him)
    if (peerId) {
        socket.to(roomId).emit("user_connected", peerId);
    }
  });

  socket.on("draw_line", (data) => {
    socket.to(data.room).volatile.emit("receive_draw", data);
  });

  socket.on("clear_canvas", (room) => {
    socket.to(room).emit("clear_canvas");
  });
});

server.listen(3001, () => {
  console.log("SERVER RUNNING ON PORT 3001");
});