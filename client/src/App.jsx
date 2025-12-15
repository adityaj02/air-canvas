import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";
const socket = io(SERVER_URL);

// Smooth interpolation
const lerp = (a, b, t) => a + (b - a) * t;

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [penColor, setPenColor] = useState("#ff4d4d");
  const [remoteStreamObj, setRemoteStreamObj] = useState(null);
  const [mainView, setMainView] = useState("local");

  const prevPoint = useRef(null);
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const colorRef = useRef(penColor);
  const lastEmitRef = useRef(0);

  // Add state for screen dimensions
  const [screenDimensions, setScreenDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });

  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

  /* =======================
      FULLSCREEN CANVAS with 21:9 Aspect Ratio
  ======================= */
  useEffect(() => {
    const resize = () => {
      if (!canvasRef.current) return;
      
      const width = window.innerWidth;
      const height = window.innerHeight;
      const targetAspectRatio = 21/9;
      const currentAspectRatio = width / height;
      
      let canvasWidth, canvasHeight, offsetX = 0, offsetY = 0;
      
      if (currentAspectRatio > targetAspectRatio) {
        // Screen is wider than 21:9
        canvasHeight = height;
        canvasWidth = height * targetAspectRatio;
        offsetX = (width - canvasWidth) / 2;
      } else {
        // Screen is taller than 21:9
        canvasWidth = width;
        canvasHeight = width / targetAspectRatio;
        offsetY = (height - canvasHeight) / 2;
      }
      
      canvasRef.current.width = canvasWidth;
      canvasRef.current.height = canvasHeight;
      
      // Store drawing area info for coordinate conversion
      canvasRef.current._drawArea = { offsetX, offsetY, canvasWidth, canvasHeight };
      
      setScreenDimensions({
        width: canvasWidth,
        height: canvasHeight,
        offsetX,
        offsetY
      });
    };
    
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  /* =======================
      CONNECTION SETUP
  ======================= */
  useEffect(() => {
    if (!joined) return;

    const peer = new Peer(undefined, {
      host: "air-canvas-2sga.onrender.com",
      secure: true,
      path: "/peerjs",
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      socket.emit("join_room", { room, peerId: id });
    });

    peer.on("call", (call) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
        call.answer(stream);
        call.on("stream", (remoteStream) => {
          setRemoteStreamObj(remoteStream);
          setMainView("remote");
        });
      });
    });

    socket.on("user_connected", callUser);
    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    startMediaPipe();

    return () => {
      socket.off("user_connected");
      socket.off("receive_draw");
      socket.off("clear_canvas");
      peer.destroy();
      cameraRef.current?.stop();
    };
  }, [joined]);

  /* =======================
      MEDIAPIPE HANDS
  ======================= */
  const startMediaPipe = async () => {
    while (!window.Hands) await new Promise(r => setTimeout(r, 300));

    const hands = new window.Hands({
      locateFile: (f) => `https://unpkg.com/@mediapipe/hands/${f}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    // Changed to 21:9 aspect ratio (1680x720)
    const camera = new window.Camera(webcamRef.current.video, {
      onFrame: async () => {
        await hands.send({ image: webcamRef.current.video });
      },
      width: 1680,  // 21:9 width
      height: 720,  // 21:9 height
    });

    camera.start();
    cameraRef.current = camera;
  };

  /* =======================
      DRAWING LOGIC (Updated for 21:9 aspect ratio)
  ======================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = null;
      return;
    }

    const now = Date.now();
    if (now - lastEmitRef.current < 15) return;
    lastEmitRef.current = now;

    const lm = results.multiHandLandmarks[0];
    const index = lm[8];
    const thumb = lm[4];

    const pinch = Math.hypot(index.x - thumb.x, index.y - thumb.y);
    if (pinch > 0.08) {
      prevPoint.current = null;
      return;
    }

    // Convert normalized coordinates to 21:9 drawing area
    const { offsetX, offsetY, canvasWidth, canvasHeight } = screenDimensions;
    
    // Convert MediaPipe coordinates (0-1) to our 21:9 canvas coordinates
    const x = (1 - index.x) * canvasWidth + offsetX;
    const y = index.y * canvasHeight + offsetY;

    if (prevPoint.current) {
      const nx = lerp(prevPoint.current.x, x, 0.25);
      const ny = lerp(prevPoint.current.y, y, 0.25);

      const payload = {
        room,
        x1: prevPoint.current.x - offsetX, // Remove offset for drawing
        y1: prevPoint.current.y - offsetY,
        x2: nx - offsetX,
        y2: ny - offsetY,
        color: colorRef.current,
        offsetX,
        offsetY
      };

      drawLine(payload);
      socket.emit("draw_line", payload);
      prevPoint.current = { x: nx, y: ny };
    } else {
      prevPoint.current = { x, y };
    }
  };

  const drawLine = ({ x1, y1, x2, y2, color, offsetX = 0, offsetY = 0 }) => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const callUser = (peerId) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      peerRef.current.call(peerId, stream).on("stream", setRemoteStreamObj);
    });
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h2>Air Canvas</h2>
          <input placeholder="Room ID" onChange={(e) => setRoom(e.target.value)} />
          <button onClick={() => setJoined(true)}>Start</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <canvas ref={canvasRef} className="canvas-overlay" />
      <div className="video-container">
        {mainView === "local" ? (
          <Webcam 
            ref={webcamRef} 
            mirrored 
            className="main-video-feed" 
          />
        ) : (
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            className="main-video-feed" 
          />
        )}
      </div>
    </>
  );
}

export default App;