import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";
const socket = io(SERVER_URL);

// SMOOTHING: Lower = Smoother but slightly more lag
const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  
  // View State
  const [mainView, setMainView] = useState("local"); 
  const [penColor, setPenColor] = useState("#ff4d4d");
  const [remoteStreamObj, setRemoteStreamObj] = useState(null);

  // DYNAMIC DIMENSIONS: Defaults to HD, but updates to match real camera
  const [videoDims, setVideoDims] = useState({ width: 1280, height: 720 });

  const prevPoint = useRef({ x: 0, y: 0 });
  const colorRef = useRef(penColor);
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const lastEmitRef = useRef(0);
  const cameraRef = useRef(null);

  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

  /* =========================
     CONNECTION & SETUP
  ========================= */
  useEffect(() => {
    if (!joined) return;

    const peer = new Peer(undefined, {
      host: "air-canvas-2sga.onrender.com",
      port: 443,
      secure: true,
      path: "/peerjs",
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      socket.emit("join_room", { room, peerId: id });
    });

    peer.on("call", (call) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          call.answer(stream);
          call.on("stream", (remoteStream) => {
            setRemoteStreamObj(remoteStream);
            setMainView("remote"); 
          });
        });
    });

    socket.on("user_connected", (peerId) => {
      callUser(peerId);
    });

    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    // Start MediaPipe (Will restart if videoDims changes)
    startMediaPipe();

    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_connected");
      peerRef.current?.destroy();
      if (cameraRef.current) cameraRef.current.stop();
    };
  }, [joined, videoDims]); // Re-run if dims change

  /* =========================
     MEDIA PIPE SETUP
  ========================= */
  const startMediaPipe = async () => {
    let tries = 0;
    while (!window.Hands && tries < 20) {
      await new Promise(r => setTimeout(r, 300));
      tries++;
    }
    if (!window.Hands) return;

    const hands = new window.Hands({
      locateFile: (f) => `https://unpkg.com/@mediapipe/hands/${f}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7, // Higher confidence to reduce jitter
      minTrackingConfidence: 0.7,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    if (webcamRef.current && webcamRef.current.video) {
      const camera = new window.Camera(webcamRef.current.video, {
        onFrame: async () => {
          if (webcamRef.current?.video) {
            await hands.send({ image: webcamRef.current.video });
          }
        },
        width: videoDims.width,  
        height: videoDims.height,
      });
      camera.start();
      cameraRef.current = camera;
    }
  };

  /* =========================
     DRAWING LOGIC (PINCH TO DRAW)
  ========================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    // Rate Limiter
    const now = Date.now();
    if (now - lastEmitRef.current < 15) return;
    lastEmitRef.current = now;

    const landmarks = results.multiHandLandmarks[0];
    const indexFinger = landmarks[8]; 
    const thumb = landmarks[4];

    // 1. PINCH DETECTION
    // Calculate distance between Index Tip (8) and Thumb Tip (4)
    const distance = Math.sqrt(
      Math.pow(indexFinger.x - thumb.x, 2) + Math.pow(indexFinger.y - thumb.y, 2)
    );

    // If fingers are far apart (> 0.08), STOP drawing
    if (distance > 0.08) {
        prevPoint.current = { x: 0, y: 0 };
        return;
    }

    // 2. COORDINATE MAPPING
    const width = videoDims.width;
    const height = videoDims.height;
    
    // Mirror the X coordinate for natural feel
    const rawX = (1 - indexFinger.x) * width;
    const rawY = indexFinger.y * height;

    let newX = rawX;
    let newY = rawY;

    // 3. SMOOTHING
    if (prevPoint.current.x !== 0) {
      newX = lerp(prevPoint.current.x, rawX, 0.2); // 0.2 = Very Smooth
      newY = lerp(prevPoint.current.y, rawY, 0.2);

      const payload = {
        room,
        x1: prevPoint.current.x,
        y1: prevPoint.current.y,
        x2: newX,
        y2: newY,
        color: colorRef.current,
      };

      drawLine(payload);
      socket.emit("draw_line", payload);
    }

    prevPoint.current = { x: newX, y: newY };
  };

  const drawLine = ({ x1, y1, x2, y2, color }) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const broadcastClear = () => {
    clearCanvasLocal();
    socket.emit("clear_canvas", { room });
  };

  const callUser = (peerId) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        const call = peerRef.current.call(peerId, stream);
        call.on("stream", (remoteStream) => {
          setRemoteStreamObj(remoteStream);
          setMainView("remote");
        });
      });
  };

  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamObj) {
      remoteVideoRef.current.srcObject = remoteStreamObj;
    }
  }, [mainView, remoteStreamObj]);

  const swapViews = () => {
    setMainView(prev => prev === "local" ? "remote" : "local");
  };

  // DETECT REAL CAMERA SIZE
  const handleVideoLoad = (stream) => {
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    
    // Update state to match real camera resolution
    const newWidth = settings.width || 1280;
    const newHeight = settings.height || 720;

    // Only update if different (prevents infinite loops)
    if (newWidth !== videoDims.width || newHeight !== videoDims.height) {
        console.log(`Camera Loaded: ${newWidth}x${newHeight}`);
        setVideoDims({ width: newWidth, height: newHeight });
    }
  };

  /* =========================
     JOIN SCREEN
  ========================= */
  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h2>Air Canvas</h2>
          <input 
            placeholder="Enter Room ID" 
            onChange={(e) => setRoom(e.target.value)} 
          />
          <button onClick={() => setJoined(true)}>Start</button>
        </div>
      </div>
    );
  }

  /* =========================
     MAIN UI
  ========================= */
  return (
    <div className="main-container">
      <div className="top-bar">
        <div className="logo">Air Canvas</div>
        <div className="top-actions">
          <input
            type="color"
            value={penColor}
            onChange={(e) => setPenColor(e.target.value)}
            className="color-picker"
          />
          <button className="clear-btn" onClick={broadcastClear}>
            Clear
          </button>
        </div>
      </div>

      <div className="stage-container">
        {/* Aspect Ratio Wrapper */}
        <div className="stage-wrapper" style={{ aspectRatio: `${videoDims.width}/${videoDims.height}` }}>
          
          {/* DRAWING LAYER */}
          <canvas 
            ref={canvasRef} 
            width={videoDims.width} 
            height={videoDims.height} 
            className="canvas-overlay" 
          />

          {/* MAIN VIDEO */}
          {mainView === "local" ? (
             <Webcam 
               ref={webcamRef} 
               mirrored 
               onUserMedia={handleVideoLoad} 
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

          {/* PiP VIDEO */}
          <div className="pip-box" onClick={swapViews}>
            {mainView === "remote" ? (
              <Webcam mirrored className="pip-feed" />
            ) : (
              <video 
                ref={(el) => { if(el && remoteStreamObj) el.srcObject = remoteStreamObj }} 
                autoPlay 
                playsInline 
                className="pip-feed" 
              />
            )}
            <div className="pip-label">Swap</div>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default App;