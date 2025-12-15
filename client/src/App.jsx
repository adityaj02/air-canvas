import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

// 1. USE YOUR ACTUAL RENDER URL HERE
const SERVER_URL = "https://air-canvas-2sga.onrender.com";

const socket = io(SERVER_URL, {
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

  useEffect(() => {
    if (!joined) return;

    // 2. FIXED: Host must match your Render URL (without https://)
    const peer = new Peer(undefined, {
      host: "air-canvas-2sga.onrender.com", // <--- UPDATE THIS
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
      if (!stream) return; // Answer only if we have a stream

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

    // --- MEDIAPIPE SETUP ---
    const Hands = window.Hands;
    const Camera = window.Camera;

    if (Hands && Camera && webcamRef.current && webcamRef.current.video) {
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
          if (webcamRef.current && webcamRef.current.video) {
            await hands.send({ image: webcamRef.current.video });
          }
        },
        width: 640,
        height: 480,
      });

      camera.start();
    }

    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_connected");
      if (peerRef.current) peerRef.current.destroy();
    };
  }, [joined]);

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

  const onResults = (results) => {
    if (!canvasRef.current) return;
    
    // Clear canvas every frame ONLY if you want temporary trails. 
    // If you want permanent drawing, remove the next line.
    // const ctx = canvasRef.current.getContext("2d");
    // ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    const hand = results.multiHandLandmarks[0];
    const index = hand[8]; // Index finger tip

    // 3. ORIENTATION FIX:
    // Because webcam is mirrored, we invert X (1 - index.x)
    const x = (1 - index.x) * canvasRef.current.width;
    const y = index.y * canvasRef.current.height;

    if (!prevPoint.current.x) {
      prevPoint.current = { x, y };
      return;
    }

    // Draw locally
    drawLine({
      x1: prevPoint.current.x,
      y1: prevPoint.current.y,
      x2: x,
      y2: y,
      color: colorRef.current,
    });

    // Send to server
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

  if (!joined) {
    return (
      <div className="join-screen">
        <h2>Air Canvas Join</h2>
        <input
          placeholder="Enter Room ID"
          onChange={(e) => setRoom(e.target.value)}
        />
        <button onClick={() => setJoined(true)}>Start</button>
      </div>
    );
  }

  return (
    <div className="main-container">
      <div className="controls">
        <h3>Room: {room}</h3>
        <button onClick={broadcastClear} className="clear-btn">Clear Board</button>
      </div>

      <div className="video-grid">
        {/* MY VIDEO CONTAINER */}
        <div className="video-wrapper local">
          <Webcam
            ref={webcamRef}
            mirrored={true}
            className="webcam"
          />
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            className="canvas"
          />
          <p className="label">You</p>
        </div>

        {/* FRIEND VIDEO CONTAINER */}
        <div className="video-wrapper remote">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="remote-video"
          />
          <p className="label">Friend</p>
        </div>
      </div>
    </div>
  );
}

export default App;