import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";

// FIXED: Socket Connection Logic
// We allow 'polling' first to wake up Render, then upgrade to 'websocket'
const socket = io(SERVER_URL, {
  transports: ['polling', 'websocket'], 
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

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
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [showInvite, setShowInvite] = useState(false);
  const [roomMembers, setRoomMembers] = useState([]);
  
  const prevPoint = useRef(null);
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const colorRef = useRef(penColor);
  const lastEmitRef = useRef(0);
  const mediaStreamRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Premium color options
  const colorOptions = [
    { name: "Crimson Red", value: "#ff4d4d", gradient: "linear-gradient(135deg, #ff4d4d, #ff3333)" },
    { name: "Emerald Green", value: "#4dff4d", gradient: "linear-gradient(135deg, #4dff4d, #33cc33)" },
    { name: "Royal Blue", value: "#4d4dff", gradient: "linear-gradient(135deg, #4d4dff, #3366ff)" },
    { name: "Sunshine Yellow", value: "#ffff4d", gradient: "linear-gradient(135deg, #ffff4d, #ffcc00)" },
    { name: "Magenta Pink", value: "#ff4dff", gradient: "linear-gradient(135deg, #ff4dff, #ff33cc)" },
    { name: "Ocean Cyan", value: "#4dffff", gradient: "linear-gradient(135deg, #4dffff, #33cccc)" },
    { name: "Pure White", value: "#ffffff", gradient: "linear-gradient(135deg, #ffffff, #f0f0f0)" },
    { name: "Deep Black", value: "#000000", gradient: "linear-gradient(135deg, #000000, #333333)" },
    { name: "Gold", value: "#ffd700", gradient: "linear-gradient(135deg, #ffd700, #ffaa00)" },
    { name: "Purple", value: "#9b59b6", gradient: "linear-gradient(135deg, #9b59b6, #8e44ad)" },
  ];

  const penSizes = [2, 4, 6, 8, 10, 12];
  const [penSize, setPenSize] = useState(6);

  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

  /* =======================
      RESIZE HANDLER (Cinematic 21:9)
  ======================= */
  useEffect(() => {
    const updateContainerSize = () => {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      
      const aspectRatio = 21/9;
      let containerWidth, containerHeight, top, left;
      
      if (windowWidth / windowHeight > aspectRatio) {
        containerHeight = Math.min(windowHeight * 0.85, windowHeight - 120);
        containerWidth = containerHeight * aspectRatio;
      } else {
        containerWidth = Math.min(windowWidth * 0.95, windowWidth - 40);
        containerHeight = containerWidth / aspectRatio;
      }
      
      top = (windowHeight - containerHeight) / 2;
      left = (windowWidth - containerWidth) / 2;
      
      setContainerSize({
        width: containerWidth,
        height: containerHeight,
        top: Math.max(top, 80),
        left
      });
      
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

    setConnectionStatus("connecting");

    const peer = new Peer(undefined, {
      host: "air-canvas-2sga.onrender.com",
      secure: true,
      path: "/peerjs",
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      },
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      console.log("Peer connected:", id);
      socket.emit("join_room", { room, peerId: id, userName: "User" });
      setConnectionStatus("connected");
      setRoomMembers([{ id, name: "You", isYou: true }]);
    });

    peer.on("call", async (call) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1280, height: 720 }, // Standard HD for transmission
          audio: true 
        });
        mediaStreamRef.current = stream;
        call.answer(stream);
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
          setRemoteStreamObj(remoteStream);
          setMainView("remote");
          setRoomMembers(prev => [...prev.filter(m => !m.isRemote), { id: call.peer, name: "Friend", isRemote: true }]);
        });
      } catch (err) { console.error(err); }
    });

    socket.on("user_connected", (data) => {
      callUser(data.peerId);
      setRoomMembers(prev => [...prev, { id: data.peerId, name: "Friend", isRemote: true }]);
    });

    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    startMediaPipe();

    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_connected");
      peerRef.current?.destroy();
      if(cameraRef.current) cameraRef.current.stop();
    };
  }, [joined]);

  /* =======================
      MEDIAPIPE SETUP
  ======================= */
  const startMediaPipe = async () => {
    let tries = 0;
    while (!window.Hands && tries < 20) {
      await new Promise(r => setTimeout(r, 500));
      tries++;
    }
    if (!window.Hands) return;

    const hands = new window.Hands({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    // Use a high res logic for detection, but map to container size later
    if (webcamRef.current?.video) {
        const camera = new window.Camera(webcamRef.current.video, {
            onFrame: async () => {
                if (webcamRef.current?.video && handsRef.current) {
                    await handsRef.current.send({ image: webcamRef.current.video });
                }
            },
            width: 1280,
            height: 720
        });
        camera.start();
        cameraRef.current = camera;
    }
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
    if (now - lastEmitRef.current < 16) return;
    lastEmitRef.current = now;

    const lm = results.multiHandLandmarks[0];
    const index = lm[8];
    const thumb = lm[4];

    // Pinch Detection
    const pinch = Math.hypot(index.x - thumb.x, index.y - thumb.y);
    
    if (pinch > 0.08) {
      prevPoint.current = null;
      setIsDrawing(false);
      return;
    }

    setIsDrawing(true);
    
    // Mapping Logic: Convert MediaPipe (0-1) to Container Pixels
    const { width, height } = containerSize;
    
    // Mirror X (1 - index.x)
    const x = (1 - index.x) * width;
    const y = index.y * height;

    if (prevPoint.current) {
      // Smoothing
      const nx = lerp(prevPoint.current.x, x, 0.3);
      const ny = lerp(prevPoint.current.y, y, 0.3);

      const payload = {
        room,
        x1: prevPoint.current.x,
        y1: prevPoint.current.y,
        x2: nx,
        y2: ny,
        color: colorRef.current,
        size: penSize
      };

      drawLine(payload);
      socket.emit("draw_line", payload);
      prevPoint.current = { x: nx, y: ny };
    } else {
      prevPoint.current = { x, y };
    }
  };

  const drawLine = ({ x1, y1, x2, y2, color, size }) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = size || penSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const callUser = async (peerId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 },
        audio: true 
      });
      mediaStreamRef.current = stream;
      const call = peerRef.current.call(peerId, stream);
      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        setRemoteStreamObj(remoteStream);
        setMainView("remote");
      });
    } catch (err) { console.error(err); }
  };

  /* =======================
      UI RENDER
  ======================= */
  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
            <h1>Air Canvas Pro</h1>
            <input 
              placeholder="Enter Room ID..." 
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              className="room-input"
            />
            <button className="join-btn" onClick={() => room && setJoined(true)}>
                Start Session
            </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Status Bar */}
      <div className={`connection-status ${connectionStatus}`}>
        <div className="status-indicator"></div>
        <span>{connectionStatus === "connected" ? "Online" : "Connecting..."}</span>
        {connectionStatus === "connected" && <span className="room-code">Room: {room}</span>}
      </div>

      {/* 21:9 Container */}
      <div 
        ref={containerRef}
        className="canvas-container"
        style={{
          width: containerSize.width,
          height: containerSize.height,
          top: containerSize.top,
          left: containerSize.left
        }}
      >
        <canvas ref={canvasRef} className="drawing-canvas" />
        
        <div className="video-feed">
          {mainView === "local" ? (
            <Webcam 
              ref={webcamRef} 
              mirrored 
              className="main-video"
              // Force Webcam to fill the 21:9 container
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
        <div className="container-glow"></div>
      </div>

      {/* Control Panel */}
      <div className="control-panel">
        <div className="panel-section">
          <h3>Drawing Tools</h3>
          <div className="color-grid">
            {colorOptions.map((color) => (
              <button
                key={color.value}
                className={`color-option ${penColor === color.value ? 'active' : ''}`}
                style={{ background: color.gradient }}
                onClick={() => setPenColor(color.value)}
              />
            ))}
          </div>
          <div className="pen-size-control">
             <span>Size:</span>
             {penSizes.map(size => (
                 <button 
                    key={size}
                    className={`size-option ${penSize === size ? 'active' : ''}`}
                    style={{width: size*3, height: size*3, background: 'white', borderRadius: '50%'}}
                    onClick={() => setPenSize(size)}
                 />
             ))}
          </div>
        </div>
        
        <div className="panel-section">
            <h3>Actions</h3>
            <button className="action-btn" onClick={() => { clearCanvasLocal(); socket.emit("clear_canvas", {room}); }}>
                🗑️ Clear
            </button>
            <button className="action-btn" onClick={() => setShowInvite(true)}>
                👥 Invite
            </button>
        </div>
      </div>

      {/* Drawing Indicator */}
      <div className={`drawing-status ${isDrawing ? 'drawing' : ''}`}>
         {isDrawing ? "✏️ Drawing" : "✋ Pinch to Draw"}
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="invite-modal" onClick={e => e.stopPropagation()}>
            <h3>Invite Friend</h3>
            <p>Room ID: <strong>{room}</strong></p>
            <button onClick={() => {navigator.clipboard.writeText(room); alert("Copied!");}}>
                Copy Room ID
            </button>
            <button className="close-modal" onClick={() => setShowInvite(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;