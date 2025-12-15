import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";
const socket = io(SERVER_URL);

// SMOOTHING: 0.5 = Balance between smooth and fast
const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  
  // View State: 'local' (Selfie) or 'remote' (Friend)
  const [mainView, setMainView] = useState("local"); 
  const [penColor, setPenColor] = useState("#ff4d4d");
  const [remoteStreamObj, setRemoteStreamObj] = useState(null);

  const prevPoint = useRef({ x: 0, y: 0 });
  const colorRef = useRef(penColor);
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const lastEmitRef = useRef(0);

  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

  /* =========================
     CONNECTION SETUP
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
            // Save stream to state so we can swap it around
            setRemoteStreamObj(remoteStream);
            setMainView("remote"); // Auto-switch to friend when they call
          });
        });
    });

    socket.on("user_connected", (peerId) => {
      callUser(peerId);
    });

    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    startMediaPipe();

    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_connected");
      peerRef.current?.destroy();
    };
  }, [joined]);

  /* =========================
     MEDIA PIPE
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
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
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
        width: 1280,  // HD Resolution
        height: 720,
      });
      camera.start();
    }
  };

  /* =========================
     DRAWING LOGIC
  ========================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    const now = Date.now();
    if (now - lastEmitRef.current < 15) return;
    lastEmitRef.current = now;

    const index = results.multiHandLandmarks[0][8]; 
    
    // IMPORTANT: Map 0-1 coordinates to the HD canvas size
    const width = canvasRef.current.width;  // Should be 1280
    const height = canvasRef.current.height; // Should be 720
    
    const rawX = (1 - index.x) * width;
    const rawY = index.y * height;

    let newX = rawX;
    let newY = rawY;

    if (prevPoint.current.x !== 0) {
      newX = lerp(prevPoint.current.x, rawX, 0.5);
      newY = lerp(prevPoint.current.y, rawY, 0.5);

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
    ctx.lineWidth = 5;
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

  // Helper to attach stream to video element when view swaps
  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamObj) {
      remoteVideoRef.current.srcObject = remoteStreamObj;
    }
  }, [mainView, remoteStreamObj]);

  const swapViews = () => {
    setMainView(prev => prev === "local" ? "remote" : "local");
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
      {/* HEADER */}
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

      {/* LAPTOP SCREEN SIMULATION */}
      <div className="stage-container">
        <div className="stage-wrapper">
          
          {/* 1. DRAWING LAYER (Fixed Size: 1280x720) */}
          <canvas 
            ref={canvasRef} 
            width={1280} 
            height={720} 
            className="canvas-overlay" 
          />

          {/* 2. MAIN VIDEO (Background) */}
          {mainView === "local" ? (
             <Webcam 
               ref={webcamRef} 
               mirrored 
               className="main-video-feed" 
               width={1280}
               height={720}
             />
          ) : (
             <video 
               ref={remoteVideoRef} 
               autoPlay 
               playsInline 
               className="main-video-feed" 
             />
          )}

          {/* 3. PiP VIDEO (Clickable) */}
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
            <div className="pip-label">Click to Swap</div>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default App;