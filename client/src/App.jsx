import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";
const socket = io(SERVER_URL);

// SMOOTHING FUNCTION (Linear Interpolation)
// 'amt' determines lag vs smoothness. 0.5 is a good balance.
const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [mainView, setMainView] = useState("remote"); // 'local' or 'remote'
  const [penColor, setPenColor] = useState("#ff4d4d");
  const [hasRemoteStream, setHasRemoteStream] = useState(false);

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
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
              setHasRemoteStream(true);
            }
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
     MEDIA PIPE (SENSITIVITY FIX)
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
      minDetectionConfidence: 0.7, // INCREASED for less hair detection
      minTrackingConfidence: 0.7,  // INCREASED for stability
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    if (webcamRef.current && webcamRef.current.video) {
      const camera = new window.Camera(webcamRef.current.video, {
        onFrame: async () => {
          if(webcamRef.current?.video) {
            await hands.send({ image: webcamRef.current.video });
          }
        },
        width: 640,
        height: 480,
      });
      camera.start();
    }
  };

  /* =========================
     DRAWING (SMOOTHING FIX)
  ========================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      // If hand is lost, reset smoothing
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    // Rate limiting to prevent flooding socket
    const now = Date.now();
    if (now - lastEmitRef.current < 20) return;
    lastEmitRef.current = now;

    const index = results.multiHandLandmarks[0][8]; // Index Finger Tip
    
    // Calculate raw coordinates
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    const rawX = (1 - index.x) * width;
    const rawY = index.y * height;

    // --- SMOOTHING LOGIC ---
    let newX = rawX;
    let newY = rawY;

    if (prevPoint.current.x !== 0) {
      // Apply Lerp: 0.5 means move 50% towards the new point (smoother)
      newX = lerp(prevPoint.current.x, rawX, 0.4);
      newY = lerp(prevPoint.current.y, rawY, 0.4);

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
    if(!ctx) return;
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round"; // Smoother corners
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if(ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
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
          if(remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            setHasRemoteStream(true);
            setMainView("remote"); // Switch to remote view when friend joins
          }
        });
      });
  };

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
     UI RENDER
  ========================= */
  return (
    <div className="main-container">
      {/* TOP BAR */}
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

      {/* STAGE AREA (Constrained Size) */}
      <div className="stage-container">
        <div className="stage-wrapper">
          
          {/* SHARED CANVAS OVERLAY (Always on top) */}
          <canvas 
            ref={canvasRef} 
            width={640} 
            height={480} 
            className="canvas-overlay" 
          />

          {/* MAIN VIEW */}
          <div className="main-view">
            {/* Logic: If mainView is local, show webcam. Else show remote. */}
            <div className={mainView === "local" ? "video-content visible" : "video-content hidden"}>
               <Webcam ref={webcamRef} mirrored className="video-feed" />
               <span className="label">ME</span>
            </div>
            
            <div className={mainView === "remote" ? "video-content visible" : "video-content hidden"}>
               <video ref={remoteVideoRef} autoPlay playsInline className="video-feed" />
               {!hasRemoteStream && <div className="waiting-msg">Waiting for friend...</div>}
               <span className="label">FRIEND</span>
            </div>
          </div>

          {/* PIP VIEW (Click to Swap) */}
          <div className="pip-view" onClick={swapViews} title="Click to Swap">
             {/* Logic: Show whichever is NOT main */}
             <div className={mainView === "remote" ? "video-content visible" : "video-content hidden"}>
               <Webcam mirrored className="video-feed" />
            </div>
            
            <div className={mainView === "local" ? "video-content visible" : "video-content hidden"}>
               <video ref={remoteVideoRef} autoPlay playsInline className="video-feed" />
            </div>
          </div>

        </div>
      </div>

      <footer className="footer">
        Powered by <span>Starx Labs</span>
      </footer>
    </div>
  );
}

export default App;