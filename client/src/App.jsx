import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";

// 1. FIXED: Socket connection (No strict transport options to prevent loops)
const socket = io(SERVER_URL);

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
  const handsRef = useRef(null);

  useEffect(() => {
    if (!joined) return;

    // --- PEERJS SETUP ---
    const peer = new Peer(undefined, {
      host: "air-canvas-2sga.onrender.com",
      port: 443,
      secure: true,
      path: "/peerjs",
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      console.log("My Peer ID:", id);
      setMyPeerId(id);
      socket.emit("join_room", { room, peerId: id });
    });

    peer.on("call", (call) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          call.answer(stream);
          call.on("stream", (remoteStream) => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
            }
          });
        });
    });

    socket.on("user_connected", (peerId) => {
      callUser(peerId);
    });

    // --- MEDIAPIPE SETUP ---
    const startMediaPipe = async () => {
      let attempts = 0;
      // Wait for window.Hands to load from index.html
      while (!window.Hands && attempts < 20) {
        console.log("Waiting for MediaPipe...");
        await new Promise(r => setTimeout(r, 500));
        attempts++;
      }

      if (!window.Hands) {
        console.error("MediaPipe failed to load.");
        return;
      }

      const hands = new window.Hands({
        // 2. FIXED: Pointing to UNPKG to match index.html
        // This fixes the "Failed to read file" error
        locateFile: (file) => {
          return `https://unpkg.com/@mediapipe/hands/${file}`;
        }
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(onResults);
      handsRef.current = hands;

      if (webcamRef.current && webcamRef.current.video) {
        const camera = new window.Camera(webcamRef.current.video, {
          onFrame: async () => {
            if (webcamRef.current?.video && handsRef.current) {
               await handsRef.current.send({ image: webcamRef.current.video });
            }
          },
          width: 640,
          height: 480,
        });
        camera.start();
      }
    };

    startMediaPipe();

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
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        const call = peerRef.current.call(peerId, stream);
        call.on("stream", (remoteStream) => {
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteStream;
            }
        });
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
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    const hand = results.multiHandLandmarks[0];
    const index = hand[8]; 

    const x = (1 - index.x) * canvasRef.current.width;
    const y = index.y * canvasRef.current.height;

    if (prevPoint.current.x) {
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
    }
    prevPoint.current = { x, y };
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <h2>Air Canvas Join</h2>
        <input placeholder="Enter Room ID" onChange={(e) => setRoom(e.target.value)} />
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
        <div className="video-wrapper local">
          <Webcam ref={webcamRef} mirrored={true} className="webcam" />
          <canvas ref={canvasRef} width={640} height={480} className="canvas" />
          <p className="label">You</p>
        </div>
        <div className="video-wrapper remote">
          <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
          <p className="label">Friend</p>
        </div>
      </div>
    </div>
  );
}

export default App;