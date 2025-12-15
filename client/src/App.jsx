import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";
// Add reconnect attempts and timeout options
const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
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
  const [showColorPicker, setShowColorPicker] = useState(false);

  const prevPoint = useRef(null);
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const colorRef = useRef(penColor);
  const lastEmitRef = useRef(0);
  const mediaStreamRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Premium color options with gradient colors
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

  // Pen sizes
  const penSizes = [2, 4, 6, 8, 10, 12];
  const [penSize, setPenSize] = useState(6);

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
      
      // Use 90% of available space for container
      if (windowWidth / windowHeight > aspectRatio) {
        // Window is wider than 21:9
        containerHeight = Math.min(windowHeight * 0.85, windowHeight - 120);
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
        top: Math.max(top, 80), // Ensure space for top controls
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
    
    return () => {
      window.removeEventListener("resize", updateContainerSize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  /* =======================
      CONNECTION SETUP with improved error handling
  ======================= */
  useEffect(() => {
    if (!joined) return;

    setConnectionStatus("connecting");

    // Initialize PeerJS with fallback options
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
      debug: 1
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      console.log("Peer connected with ID:", id);
      socket.emit("join_room", { room, peerId: id, userName: "User" });
      setConnectionStatus("connected");
      
      // Update room members list
      setRoomMembers([{ id, name: "You", isYou: true }]);
    });

    peer.on("error", (err) => {
      console.error("PeerJS error:", err);
      setConnectionStatus("error");
    });

    peer.on("call", async (call) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1680, height: 720 },
          audio: true 
        });
        
        mediaStreamRef.current = stream;
        call.answer(stream);
        
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
          setRemoteStreamObj(remoteStream);
          setMainView("remote");
          
          // Add remote user to room members
          setRoomMembers(prev => [...prev.filter(m => !m.isRemote), { 
            id: call.peer, 
            name: "Friend", 
            isRemote: true 
          }]);
        });
      } catch (err) {
        console.error("Error answering call:", err);
      }
    });

    // Socket event handlers
    socket.on("connect", () => {
      console.log("Socket connected");
      setConnectionStatus("connected");
    });

    socket.on("user_connected", (data) => {
      console.log("User connected:", data);
      callUser(data.peerId);
      
      // Add user to room members
      setRoomMembers(prev => [...prev, { 
        id: data.peerId, 
        name: data.userName || "Friend", 
        isRemote: true 
      }]);
    });

    socket.on("user_disconnected", (peerId) => {
      console.log("User disconnected:", peerId);
      setRoomMembers(prev => prev.filter(member => member.id !== peerId));
    });

    socket.on("room_users", (users) => {
      console.log("Room users:", users);
      setRoomMembers(users.map(user => ({
        id: user.peerId,
        name: user.userName,
        isRemote: user.peerId !== peerRef.current?.id,
        isYou: user.peerId === peerRef.current?.id
      })));
    });

    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    // Start hand tracking
    startMediaPipe();

    return () => {
      socket.off("connect");
      socket.off("user_connected");
      socket.off("user_disconnected");
      socket.off("room_users");
      socket.off("receive_draw");
      socket.off("clear_canvas");
      
      if (peerRef.current) {
        peerRef.current.destroy();
      }
      
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [joined]);

  /* =======================
      IMPROVED MEDIAPIPE HANDS with fallback
  ======================= */
  const startMediaPipe = async () => {
    try {
      // Check if MediaPipe is available
      if (typeof window.Hands === 'undefined') {
        console.log("Loading MediaPipe hands...");
        await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
          script.onload = resolve;
          script.onerror = () => {
            console.error("Failed to load MediaPipe hands");
            resolve();
          };
          document.head.appendChild(script);
        });
        
        // Wait a bit more for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (typeof window.Hands === 'undefined') {
        console.error("MediaPipe hands not available, using fallback");
        startFallbackHandTracking();
        return;
      }

      initializeHands();
    } catch (error) {
      console.error("Error loading MediaPipe:", error);
      startFallbackHandTracking();
    }
  };

  const initializeHands = () => {
    try {
      const hands = new window.Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7,
      });

      hands.onResults(onResults);
      handsRef.current = hands;

      const camera = new window.Camera(webcamRef.current?.video, {
        onFrame: async () => {
          if (handsRef.current && webcamRef.current?.video) {
            await handsRef.current.send({ image: webcamRef.current.video });
          }
        },
        width: 1680,
        height: 720,
      });

      camera.start();
      cameraRef.current = camera;
    } catch (error) {
      console.error("Error initializing hands:", error);
      startFallbackHandTracking();
    }
  };

  const startFallbackHandTracking = () => {
    console.log("Using fallback hand tracking");
    // Simple mouse-based fallback for testing
    const handleMouseMove = (e) => {
      if (!isDrawing) return;
      
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (prevPoint.current) {
        const payload = {
          room,
          x1: prevPoint.current.x,
          y1: prevPoint.current.y,
          x2: x,
          y2: y,
          color: colorRef.current,
          size: penSize
        };
        
        drawLine(payload);
        socket.emit("draw_line", payload);
      }
      
      prevPoint.current = { x, y };
    };
    
    const handleMouseDown = () => setIsDrawing(true);
    const handleMouseUp = () => {
      setIsDrawing(false);
      prevPoint.current = null;
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
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
    if (now - lastEmitRef.current < 16) return; // ~60fps
    lastEmitRef.current = now;

    const lm = results.multiHandLandmarks[0];
    const index = lm[8];
    const thumb = lm[4];

    // Calculate pinch distance
    const pinch = Math.hypot(index.x - thumb.x, index.y - thumb.y);
    
    if (pinch > 0.08) {
      prevPoint.current = null;
      setIsDrawing(false);
      return;
    }

    // Pinching - start drawing
    setIsDrawing(true);
    
    // Get container dimensions
    const { width, height, left, top } = containerSize;
    
    if (width === 0 || height === 0) return;
    
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
        size: penSize
      };

      drawLine(payload);
      socket.emit("draw_line", payload);
      prevPoint.current = { x: nx, y: ny };
    } else {
      prevPoint.current = { x, y };
    }
  };

  const drawLine = ({ x1, y1, x2, y2, color, size = penSize }) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = size;
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

  const callUser = async (peerId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1680, height: 720 },
        audio: true 
      });
      
      mediaStreamRef.current = stream;
      const call = peerRef.current.call(peerId, stream);
      
      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        setRemoteStreamObj(remoteStream);
        setMainView("remote");
      });
    } catch (err) {
      console.error("Error calling user:", err);
      alert("Failed to establish connection. Please check your camera permissions.");
    }
  };

  const switchView = () => {
    setMainView(prev => prev === "local" ? "remote" : "local");
  };

  const copyRoomLink = () => {
    const roomLink = `${window.location.origin}?room=${room}`;
    navigator.clipboard.writeText(roomLink);
    alert("Room link copied to clipboard! Share it with friends.");
  };

  const generateInviteLink = () => {
    const roomLink = `${window.location.origin}?room=${room}`;
    return roomLink;
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <div className="logo-container">
            <div className="logo-icon">✏️</div>
            <h1>Air Canvas Pro</h1>
            <p className="tagline">Draw in the air with friends in real-time</p>
          </div>
          
          <div className="input-group">
            <input 
              placeholder="Enter Room ID (e.g., cool-room-123)" 
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && setJoined(true)}
              className="room-input"
            />
            <div className="room-actions">
              <button 
                className="generate-btn"
                onClick={() => setRoom(`room-${Math.random().toString(36).substr(2, 9)}`)}
              >
                Generate Room
              </button>
            </div>
          </div>
          
          <button 
            className="join-btn"
            onClick={() => {
              if (room.trim()) {
                setJoined(true);
              } else {
                alert("Please enter a room ID or generate one!");
              }
            }}
          >
            🎨 Start Drawing Session
          </button>
          
          <div className="features-list">
            <div className="feature">
              <span className="feature-icon">👐</span>
              <span>Hand Gesture Drawing</span>
            </div>
            <div className="feature">
              <span className="feature-icon">👥</span>
              <span>Real-time Collaboration</span>
            </div>
            <div className="feature">
              <span className="feature-icon">🎨</span>
              <span>Multiple Colors & Brushes</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Connection Status Bar */}
      <div className={`connection-status ${connectionStatus}`}>
        <div className="status-indicator"></div>
        <span className="status-text">
          {connectionStatus === "connected" ? "Connected" : 
           connectionStatus === "connecting" ? "Connecting..." : 
           "Disconnected"}
        </span>
        {connectionStatus === "connected" && (
          <span className="room-code">Room: {room}</span>
        )}
      </div>

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
        
        {/* Container Border Glow */}
        <div className="container-glow"></div>
      </div>

      {/* Premium Control Panel */}
      <div className="control-panel">
        <div className="panel-section">
          <h3 className="section-title">
            <span className="section-icon">🎨</span>
            Drawing Tools
          </h3>
          
          <div className="color-grid">
            {colorOptions.map((color) => (
              <button
                key={color.value}
                className={`color-option ${penColor === color.value ? 'active' : ''}`}
                style={{ background: color.gradient }}
                onClick={() => setPenColor(color.value)}
                title={color.name}
              >
                {penColor === color.value && <div className="color-check">✓</div>}
              </button>
            ))}
          </div>
          
          <div className="pen-size-control">
            <span className="size-label">Brush Size</span>
            <div className="size-options">
              {penSizes.map((size) => (
                <button
                  key={size}
                  className={`size-option ${penSize === size ? 'active' : ''}`}
                  onClick={() => setPenSize(size)}
                  style={{ width: `${size * 2}px`, height: `${size * 2}px` }}
                  title={`Size ${size}`}
                />
              ))}
            </div>
          </div>
        </div>
        
        <div className="panel-section">
          <h3 className="section-title">
            <span className="section-icon">⚡</span>
            Actions
          </h3>
          
          <div className="action-grid">
            <button className="action-btn clear-action" onClick={clearCanvas}>
              <span className="action-icon">🗑️</span>
              <span className="action-label">Clear Canvas</span>
            </button>
            
            <button className="action-btn view-action" onClick={switchView}>
              <span className="action-icon">{mainView === "local" ? "👁️" : "📹"}</span>
              <span className="action-label">
                {mainView === "local" ? "View Friend" : "View Self"}
              </span>
            </button>
            
            <button className="action-btn invite-action" onClick={() => setShowInvite(true)}>
              <span className="action-icon">👥</span>
              <span className="action-label">Invite Friends</span>
            </button>
          </div>
        </div>
      </div>

      {/* Drawing Status */}
      <div className={`drawing-status ${isDrawing ? 'drawing' : ''}`}>
        <div className="drawing-indicator">
          <div className="drawing-dot"></div>
          <span className="drawing-text">
            {isDrawing ? "✏️ Drawing..." : "👌 Pinch to draw"}
          </span>
          {isDrawing && <div className="drawing-pulse"></div>}
        </div>
      </div>

      {/* Room Members */}
      <div className="room-members">
        <div className="members-header">
          <span className="members-icon">👥</span>
          <span className="members-title">Room Members</span>
          <span className="members-count">{roomMembers.length}</span>
        </div>
        <div className="members-list">
          {roomMembers.map((member, index) => (
            <div key={member.id || index} className="member-item">
              <div className={`member-avatar ${member.isYou ? 'you' : 'friend'}`}>
                {member.isYou ? '👤' : '👥'}
              </div>
              <span className="member-name">
                {member.name}
                {member.isYou && <span className="you-badge">You</span>}
              </span>
            </div>
          ))}
          {roomMembers.length === 1 && (
            <div className="no-friends">
              <span className="no-friends-icon">👋</span>
              <span className="no-friends-text">Invite friends to join!</span>
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="invite-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Invite Friends</h3>
              <button className="close-modal" onClick={() => setShowInvite(false)}>×</button>
            </div>
            <div className="modal-content">
              <p>Share this link with friends to join your drawing session:</p>
              <div className="invite-link">
                <code>{generateInviteLink()}</code>
                <button className="copy-link" onClick={copyRoomLink}>
                  📋 Copy
                </button>
              </div>
              <div className="invite-actions">
                <button className="whatsapp-share" onClick={() => {
                  const text = `Join my Air Canvas drawing session! Room: ${room}`;
                  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
                  window.open(url, '_blank');
                }}>
                  💬 Share on WhatsApp
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leave Button */}
      <button className="leave-session-btn" onClick={() => setJoined(false)}>
        <span className="leave-icon">🚪</span>
        Leave Session
      </button>
    </div>
  );
}

export default App;