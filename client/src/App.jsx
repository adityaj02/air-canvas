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
  const [isDrawing, setIsDrawing] = useState(false);

  const prevPoint = useRef(null);
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const colorRef = useRef(penColor);
  const lastEmitRef = useRef(0);
  const drawingAreaRef = useRef({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0
  });

  // Color options
  const colorOptions = [
    "#ff4d4d", // Red
    "#4dff4d", // Green
    "#4d4dff", // Blue
    "#ffff4d", // Yellow
    "#ff4dff", // Pink
    "#4dffff", // Cyan
    "#ffffff", // White
    "#000000"  // Black
  ];

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
      
      // Store drawing area info
      drawingAreaRef.current = { 
        width: canvasWidth, 
        height: canvasHeight, 
        offsetX, 
        offsetY 
      };
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
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
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
    // Load MediaPipe hands
    if (!window.Hands) {
      const script = document.createElement('script');
      script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
      script.onload = () => initializeHands();
      document.head.appendChild(script);
    } else {
      initializeHands();
    }
  };

  const initializeHands = () => {
    const hands = new window.Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
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

    const camera = new window.Camera(webcamRef.current.video, {
      onFrame: async () => {
        if (handsRef.current) {
          await handsRef.current.send({ image: webcamRef.current.video });
        }
      },
      width: 1680,
      height: 720,
    });

    camera.start();
    cameraRef.current = camera;
  };

  /* =======================
      DRAWING LOGIC
  ======================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = null;
      setIsDrawing(false);
      return;
    }

    const now = Date.now();
    if (now - lastEmitRef.current < 15) return;
    lastEmitRef.current = now;

    const lm = results.multiHandLandmarks[0];
    const index = lm[8];
    const thumb = lm[4];

    // Calculate pinch distance
    const pinch = Math.hypot(index.x - thumb.x, index.y - thumb.y);
    
    if (pinch > 0.08) {
      // Not pinching - stop drawing
      prevPoint.current = null;
      setIsDrawing(false);
      return;
    }

    // Pinching - start drawing
    setIsDrawing(true);
    
    // Get drawing area dimensions
    const { width, height, offsetX, offsetY } = drawingAreaRef.current;
    
    // Convert normalized coordinates to canvas coordinates
    const x = (1 - index.x) * width + offsetX;
    const y = index.y * height + offsetY;

    if (prevPoint.current) {
      const nx = lerp(prevPoint.current.x, x, 0.3);
      const ny = lerp(prevPoint.current.y, y, 0.3);

      const payload = {
        room,
        x1: prevPoint.current.x - offsetX,
        y1: prevPoint.current.y - offsetY,
        x2: nx - offsetX,
        y2: ny - offsetY,
        color: colorRef.current,
      };

      drawLine(payload);
      socket.emit("draw_line", payload);
      prevPoint.current = { x: nx, y: ny };
    } else {
      prevPoint.current = { x, y };
    }
  };

  const drawLine = ({ x1, y1, x2, y2, color }) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const clearCanvas = () => {
    clearCanvasLocal();
    socket.emit("clear_canvas", { room });
  };

  const callUser = (peerId) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      peerRef.current.call(peerId, stream).on("stream", (remoteStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        setRemoteStreamObj(remoteStream);
        setMainView("remote");
      });
    });
  };

  const switchView = () => {
    setMainView(prev => prev === "local" ? "remote" : "local");
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h2>✏️ Air Canvas</h2>
          <p>Join or create a room to start drawing</p>
          <input 
            placeholder="Enter Room ID" 
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && setJoined(true)}
          />
          <button onClick={() => room.trim() ? setJoined(true) : alert("Please enter a room ID")}>
            Start Drawing
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Canvas for drawing */}
      <canvas ref={canvasRef} className="canvas-overlay" />
      
      {/* Video Container */}
      <div className="video-container">
        {mainView === "local" ? (
          <Webcam 
            ref={webcamRef} 
            mirrored 
            className="main-video-feed" 
            videoConstraints={{
              width: 1680,
              height: 720,
              aspectRatio: 21/9
            }}
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

      {/* Control Panel */}
      <div className="control-panel">
        <div className="color-picker">
          {colorOptions.map((color) => (
            <button
              key={color}
              className={`color-btn ${penColor === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => setPenColor(color)}
              title={`Select ${color}`}
            />
          ))}
        </div>
        
        <div className="control-buttons">
          <button className="control-btn clear-btn" onClick={clearCanvas} title="Clear Canvas">
            🗑️ Clear
          </button>
          <button className="control-btn switch-btn" onClick={switchView} title="Switch View">
            {mainView === "local" ? "👁️ View Remote" : "👁️ View Self"}
          </button>
        </div>
      </div>

      {/* Drawing Status Indicator */}
      <div className={`drawing-status ${isDrawing ? 'drawing' : ''}`}>
        <div className="status-dot"></div>
        <span>{isDrawing ? "Drawing..." : "Pinch to draw"}</span>
      </div>

      {/* Room Info */}
      <div className="room-info">
        <span>Room: {room}</span>
        <button className="leave-btn" onClick={() => setJoined(false)}>Leave</button>
      </div>
    </>
  );
}

export default App;