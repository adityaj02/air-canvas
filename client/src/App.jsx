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
  const containerRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [penColor, setPenColor] = useState("#ff4d4d");
  const [remoteStreamObj, setRemoteStreamObj] = useState(null);
  const [mainView, setMainView] = useState("local");
  const [isDrawing, setIsDrawing] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0, top: 0, left: 0 });

  const prevPoint = useRef(null);
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const colorRef = useRef(penColor);
  const lastEmitRef = useRef(0);

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
      RESIZE HANDLER for 21:9 Container
  ======================= */
  useEffect(() => {
    const updateContainerSize = () => {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      
      // Calculate 21:9 aspect ratio dimensions
      const aspectRatio = 21/9;
      let containerWidth, containerHeight, top, left;
      
      if (windowWidth / windowHeight > aspectRatio) {
        // Window is wider than 21:9
        containerHeight = Math.min(windowHeight * 0.9, windowHeight - 100); // Leave space for controls
        containerWidth = containerHeight * aspectRatio;
      } else {
        // Window is taller than 21:9
        containerWidth = Math.min(windowWidth * 0.95, windowWidth - 40);
        containerHeight = containerWidth / aspectRatio;
      }
      
      // Center the container
      top = (windowHeight - containerHeight) / 2;
      left = (windowWidth - containerWidth) / 2;
      
      setContainerSize({
        width: containerWidth,
        height: containerHeight,
        top,
        left
      });
      
      // Update canvas size
      if (canvasRef.current) {
        canvasRef.current.width = containerWidth;
        canvasRef.current.height = containerHeight;
      }
    };
    
    updateContainerSize();
    window.addEventListener("resize", updateContainerSize);
    
    return () => window.removeEventListener("resize", updateContainerSize);
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
      width: 1680, // 21:9 width
      height: 720, // 21:9 height
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
    
    // Get container dimensions
    const { width, height, left, top } = containerSize;
    
    // Convert normalized coordinates to container coordinates
    const x = (1 - index.x) * width + left;
    const y = index.y * height + top;

    if (prevPoint.current) {
      const nx = lerp(prevPoint.current.x, x, 0.3);
      const ny = lerp(prevPoint.current.y, y, 0.3);

      // Convert to canvas coordinates (relative to container)
      const canvasX1 = prevPoint.current.x - left;
      const canvasY1 = prevPoint.current.y - top;
      const canvasX2 = nx - left;
      const canvasY2 = ny - top;

      const payload = {
        room,
        x1: canvasX1,
        y1: canvasY1,
        x2: canvasX2,
        y2: canvasY2,
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
    ctx.lineWidth = 6;
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
    <div className="app-container">
      {/* 21:9 Container Box */}
      <div 
        ref={containerRef}
        className="canvas-container"
        style={{
          width: `${containerSize.width}px`,
          height: `${containerSize.height}px`,
          top: `${containerSize.top}px`,
          left: `${containerSize.left}px`
        }}
      >
        {/* Canvas for drawing */}
        <canvas 
          ref={canvasRef} 
          className="drawing-canvas"
          style={{
            width: '100%',
            height: '100%'
          }}
        />
        
        {/* Video Feed */}
        <div className="video-feed">
          {mainView === "local" ? (
            <Webcam 
              ref={webcamRef} 
              mirrored 
              className="main-video"
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
              className="main-video"
            />
          )}
        </div>
      </div>

      {/* Control Panel */}
      <div className="control-panel">
        <div className="color-picker-section">
          <h3>Pen Color</h3>
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
        </div>
        
        <div className="action-buttons">
          <button className="action-btn clear-btn" onClick={clearCanvas} title="Clear Canvas">
            <span className="btn-icon">🗑️</span>
            <span className="btn-text">Clear Canvas</span>
          </button>
          
          <button className="action-btn switch-btn" onClick={switchView} title="Switch View">
            <span className="btn-icon">{mainView === "local" ? "👁️" : "📹"}</span>
            <span className="btn-text">{mainView === "local" ? "View Remote" : "View Self"}</span>
          </button>
        </div>
      </div>

      {/* Drawing Status */}
      <div className={`drawing-status ${isDrawing ? 'drawing' : ''}`}>
        <div className="status-indicator">
          <div className="status-dot"></div>
          <span className="status-text">
            {isDrawing ? "Drawing..." : "Pinch thumb and index finger to draw"}
          </span>
        </div>
      </div>

      {/* Room Info */}
      <div className="room-info">
        <div className="room-id">
          <span className="room-label">Room:</span>
          <span className="room-value">{room}</span>
        </div>
        <button className="leave-btn" onClick={() => setJoined(false)}>
          <span className="leave-icon">🚪</span>
          Leave Room
        </button>
      </div>
    </div>
  );
}

export default App;