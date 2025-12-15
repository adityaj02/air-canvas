import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

/* =========================
   SOCKET (Render Backend)
========================= */
const socket = io("https://air-canvas-2sga.onrender.com", {
  transports: ["websocket"],
});

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [myPeerId, setMyPeerId] = useState("");

  const prevPoint = useRef({ x: 0, y: 0 });
  const colorRef = useRef("#FF0000");
  const peerRef = useRef(null);

  /* =========================
     MAIN EFFECT
  ========================= */
  useEffect(() => {
    if (!joined) return;

    /* -------------------------
       1. PEERJS (SELF-HOSTED)
    ------------------------- */
    const peer = new Peer(undefined, {
      host: "air-canvas-backend.onrender.com", // NO https
      port: 443,
      secure: true,
      path: "/peerjs",
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      setMyPeerId(id);
      socket.emit("join_room", { room, peerId: id });
    });

    peer.on("call", (call) => {
      const stream = webcamRef.current?.video?.srcObject;
      if (!stream) return;

      call.answer(stream);
      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      });
    });

    socket.on("user_connected", (peerId) => {
      callUser(peerId);
    });

    /* -------------------------
       2. MEDIAPIPE DRAWING
    ------------------------- */
    const Hands = window.Hands;
    const Camera = window.Camera;

    if (!Hands || !Camera) {
      console.error("MediaPipe scripts not loaded");
      return;
    }

    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(onResults);

    const camera = new Camera(webcamRef.current.video, {
      onFrame: async () => {
        await hands.send({ image: webcamRef.current.video });
      },
      width: 640,
      height: 480,
    });

    camera.start();

    /* -------------------------
       3. SOCKET DRAW EVENTS
    ------------------------- */
    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_connected");
      peer.destroy();
    };
  }, [joined]);

  /* =========================
     VIDEO CALL HELPER
  ========================= */
  const callUser = (peerId) => {
    const stream = webcamRef.current?.video?.srcObject;
    if (!stream || !peerRef.current) return;

    const call = peerRef.current.call(peerId, stream);
    call.on("stream", (remoteStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    });
  };

  /* =========================
     DRAWING HELPERS
  ========================= */
  const drawLine = ({ x1, y1, x2, y2, color }) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const broadcastClear = () => {
    clearCanvasLocal();
    socket.emit("clear_canvas", room);
  };

  /* =========================
     MEDIAPIPE RESULTS
  ========================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    const hand = results.multiHandLandmarks[0];
    const index = hand[8];

    const x = (1 - index.x) * canvasRef.current.width;
    const y = index.y * canvasRef.current.height;

    if (!prevPoint.current.x) {
      prevPoint.current = { x, y };
      return;
    }

    drawLine({
      x1: prevPoint.current.x,
      y1: prevPoint.current.y,
      x2: x,
      y2: y,
      color: colorRef.current,
    });

    socket.emit("draw_line", {
      room,
      x1: prevPoint.current.x,
      y1: prevPoint.current.y,
      x2: x,
      y2: y,
      color: colorRef.current,
    });

    prevPoint.current = { x, y };
  };

  /* =========================
     UI
  ========================= */
  if (!joined) {
    return (
      <div className="join">
        <h2>Join Room</h2>
        <input
          placeholder="Room ID"
          onChange={(e) => setRoom(e.target.value)}
        />
        <button onClick={() => setJoined(true)}>Join</button>
      </div>
    );
  }

  return (
    <div className="main">
      <h3>Room: {room}</h3>
      <button onClick={broadcastClear}>Clear</button>

      <div className="videos">
        <div className="canvas-box">
          <Webcam ref={webcamRef} mirrored />
          <canvas ref={canvasRef} width={640} height={480} />
        </div>

        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{ width: "640px", height: "480px", background: "black" }}
        />
      </div>
    </div>
  );
}

export default App;
