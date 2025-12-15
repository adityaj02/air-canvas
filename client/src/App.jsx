import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";

const socket = io(SERVER_URL, {
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

const lerp = (a, b, t) => a + (b - a) * t;

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null);
  
  // New ref for the inner wrapper (Video+Canvas)
  const contentWrapperRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [penColor, setPenColor] = useState("#ff4d4d");
  const [remoteStreamObj, setRemoteStreamObj] = useState(null);
  const [mainView, setMainView] = useState("local");
  const [isDrawing, setIsDrawing] = useState(false);
  
  // Dimensions for the 21:9 Outer Container
  const [outerContainerSize, setOuterContainerSize] = useState({ width: 0, height: 0, top: 0, left: 0 });
  
  // Aspect Ratio of the actual camera (defaults to 16:9)
  const [cameraRatio, setCameraRatio] = useState(16/9);

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

  // Colors
  const colorOptions = [
    { name: "Crimson Red", value: "#ff4d4d", gradient: "linear-gradient(135deg, #ff4d4d, #ff3333)" },
    { name: "Emerald Green", value: "#4dff4d", gradient: "linear-gradient(135deg, #4dff4d, #33cc33)" },
    { name: "Royal Blue", value: "#4d4dff", gradient: "linear-gradient(135deg, #4d4dff, #3366ff)" },
    { name: "Sunshine Yellow", value: "#ffff4d", gradient: "linear-gradient(135deg, #ffff4d, #ffcc00)" },
    { name: "Magenta Pink", value: "#ff4dff", gradient: "linear-gradient(135deg, #ff4dff, #ff33cc)" },
    { name: "Ocean Cyan", value: "#4dffff", gradient: "linear-gradient(135deg, #4dffff, #33cccc)" },
    { name: "Pure White", value: "#ffffff", gradient: "linear-gradient(135deg, #ffffff, #f0f0f0)" },
    { name: "Deep Black", value: "#000000", gradient: "linear-gradient(135deg, #000000, #333333)" },
  ];

  const penSizes = [2, 4, 6, 8, 10, 12];
  const [penSize, setPenSize] = useState(6);

  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

  /* =======================
      RESIZE HANDLER (Calculates 21:9 Box)
  ======================= */
  useEffect(() => {
    const updateLayout = () => {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      
      // Target Aspect Ratio: 21:9
      const targetRatio = 21/9;
      let w, h, top, left;
      
      // Calculate max size that fits in window while maintaining 21:9
      if (windowWidth / windowHeight > targetRatio) {
        h = Math.min(windowHeight * 0.9, windowHeight - 100);
        w = h * targetRatio;
      } else {
        w = Math.min(windowWidth * 0.95, windowWidth - 40);
        h = w / targetRatio;
      }
      
      top = (windowHeight - h) / 2;
      left = (windowWidth - w) / 2;
      
      setOuterContainerSize({ width: w, height: h, top: Math.max(top, 60), left });
    };
    
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  /* =======================
      DETECT CAMERA RATIO
  ======================= */
  const handleVideoLoad = (stream) => {
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    if (settings.width && settings.height) {
        setCameraRatio(settings.width / settings.height);
    }
  };

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
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      socket.emit("join_room", { room, peerId: id, userName: "User" });
      setConnectionStatus("connected");
      setRoomMembers([{ id, name: "You", isYou: true }]);
    });

    peer.on("call", async (call) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1280, height: 720 },
          audio: true 
        });
        mediaStreamRef.current = stream;
        handleVideoLoad(stream); // Detect ratio
        call.answer(stream);
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
          setRemoteStreamObj(remoteStream);
          setMainView("remote");
          setRoomMembers(prev => [...prev.filter(m => !m.isRemote), { id: call.peer, name: "Friend", isRemote: true }]);
        });
      } catch (err) { console.error(err); }
    });

    socket.on("user_connected", (data) => callUser(data.peerId));
    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    startMediaPipe();

    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_connected");
      if(peerRef.current) peerRef.current.destroy();
      if(cameraRef.current) cameraRef.current.stop();
    };
  }, [joined]);

  /* =======================
      MEDIAPIPE
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

    // Rate Limit
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
    
    // MAPPING: Use the size of the inner wrapper (video size)
    const wrapper = contentWrapperRef.current;
    if (!wrapper) return;
    
    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;
    
    // Mirror X coordinate
    const x = (1 - index.x) * width;
    const y = index.y * height;

    if (prevPoint.current) {
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
      handleVideoLoad(stream);
      const call = peerRef.current.call(peerId, stream);
      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        setRemoteStreamObj(remoteStream);
        setMainView("remote");
      });
    } catch (err) { console.error(err); }
  };

  const switchView = () => {
    setMainView(prev => prev === "local" ? "remote" : "local");
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
      <div className={`connection-status ${connectionStatus}`}>
        <div className="status-indicator"></div>
        <span>{connectionStatus === "connected" ? "Online" : "Connecting..."}</span>
        {connectionStatus === "connected" && <span className="room-code">Room: {room}</span>}
      </div>

      {/* 21:9 OUTER CONTAINER */}
      <div 
        ref={containerRef}
        className="canvas-container"
        style={{
          width: outerContainerSize.width,
          height: outerContainerSize.height,
          top: outerContainerSize.top,
          left: outerContainerSize.left
        }}
      >
        {/* INNER WRAPPER: Matches CAMERA aspect ratio & centers content */}
        <div 
            ref={contentWrapperRef}
            className="content-wrapper"
            style={{ 
                aspectRatio: `${cameraRatio}`,
                height: '100%',
                margin: '0 auto', // Centers horizontally
                position: 'relative'
            }}
        >
            {/* Canvas overlay matches inner wrapper exactly */}
            <canvas 
                ref={canvasRef} 
                className="drawing-canvas" 
                width={outerContainerSize.height * cameraRatio}
                height={outerContainerSize.height}
            />
            
            <div className="video-feed">
            {mainView === "local" ? (
                <Webcam 
                ref={webcamRef} 
                mirrored 
                className="main-video"
                onUserMedia={handleVideoLoad}
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
        <div className="container-glow"></div>
      </div>

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
            <button className="action-btn" onClick={switchView}>
                {mainView === "local" ? "👁️ View Friend" : "📹 View Self"}
            </button>
            <button className="action-btn" onClick={() => setShowInvite(true)}>
                👥 Invite
            </button>
        </div>
      </div>

      <div className={`drawing-status ${isDrawing ? 'drawing' : ''}`}>
         {isDrawing ? "✏️ Drawing" : "✋ Pinch to Draw"}
      </div>

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