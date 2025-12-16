import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import Peer from "peerjs";
import { FaEraser, FaUserFriends, FaExchangeAlt } from "react-icons/fa";

// --- CONFIGURATION ---
// 1. Dynamic Server URL: Uses Vercel/Netlify env var if present, else localhost
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

const COLORS = ["#ff4d4d", "#4dff4d", "#4d4dff", "#ffff4d", "#ff4dff", "#ffffff"];
const SIZES = [4, 8, 12];
const lerp = (a, b, t) => a + (b - a) * t;

// Initialize Socket with the dynamic URL
const socket = io(SERVER_URL, { transports: ["websocket", "polling"] });

function App() {
  const webcamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const cursorRef = useRef(null);
  
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const prevPoint = useRef(null);
  const lastEmitRef = useRef(0);
  const smoothedPos = useRef({ x: 0, y: 0 });
  const callsRef = useRef([]); 
  
  const colorRef = useRef("#ff4d4d");
  const sizeRef = useRef(8);

  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [mainView, setMainView] = useState("local");
  const [penColor, setPenColor] = useState("#ff4d4d");
  const [penSize, setPenSize] = useState(8);
  const [handDetected, setHandDetected] = useState(false);

  useEffect(() => { colorRef.current = penColor; }, [penColor]);
  useEffect(() => { sizeRef.current = penSize; }, [penSize]);

  // --- Canvas Resizing ---
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
        if (containerRef.current && canvasRef.current) {
            canvasRef.current.width = containerRef.current.clientWidth;
            canvasRef.current.height = containerRef.current.clientHeight;
        }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [joined]);

  // --- Networking & PeerJS ---
  useEffect(() => {
    if (!joined) return;

    // --- INTEGRATION: Smart Peer Configuration ---
    // If on localhost, use local backend. If on production, use your Render/Heroku URL.
    const isProduction = window.location.hostname !== "localhost";
    const peerConfig = isProduction 
      ? { 
          host: "https://air-canvas-2sga.onrender.com", // ⚠️ REPLACE WITH YOUR ACTUAL RENDER URL
          port: 443, 
          secure: true,
          path: "/" 
        }
      : { 
          host: "localhost", 
          port: 3001, 
          path: "/peerjs" 
        };

    const peer = new Peer(undefined, peerConfig);
    peerRef.current = peer;

    peer.on("open", (id) => {
      socket.emit("join_room", { room: roomId, peerId: id });
    });

    peer.on("call", (call) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          call.answer(stream);
          call.on("stream", (remoteStream) => {
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
          });
          callsRef.current.push(call);
        });
    });

    socket.on("user_connected", (remotePeerId) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          const call = peer.call(remotePeerId, stream);
          call.on("stream", (remoteStream) => {
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
          });
          callsRef.current.push(call);
        });
    });

    socket.on("user_disconnected", () => {
       if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    });

    socket.on("receive_draw", (data) => drawLine(data));
    socket.on("clear_canvas", clearCanvasLocal);

    startMediaPipe();

    return () => {
      socket.off("user_connected");
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_disconnected");
      if (peerRef.current) peerRef.current.destroy();
      // --- INTEGRATION: Proper Cleanup ---
      if (handsRef.current) handsRef.current.close();
    };
  }, [joined, roomId]);

  // --- Drawing Logic ---
  const drawLine = (data) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // --- INTEGRATION: Performance Fix (willReadFrequently) ---
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    
    ctx.beginPath();
    ctx.moveTo(data.x1 * canvas.width, data.y1 * canvas.height);
    ctx.lineTo(data.x2 * canvas.width, data.y2 * canvas.height);
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const clearCanvasAll = () => {
    clearCanvasLocal();
    socket.emit("clear_canvas", { room: roomId });
  };

  // --- MediaPipe Logic ---
  const onResults = (results) => {
    const canvas = canvasRef.current;
    const video = webcamRef.current;

    // --- INTEGRATION: Strict Safety Check ---
    if (!canvas || !video || video.videoWidth === 0) return;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      if (!handDetected) setHandDetected(true);
      
      const landmarks = results.multiHandLandmarks[0];
      const idxTip = landmarks[8];
      const thumbTip = landmarks[4];

      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      const dstW = canvas.width;
      const dstH = canvas.height;

      // Aspect Ratio Correction
      const scale = Math.max(dstW / srcW, dstH / srcH);
      const scaledW = srcW * scale;
      const scaledH = srcH * scale;
      const offsetX = (dstW - scaledW) / 2;
      const offsetY = (dstH - scaledH) / 2;

      // Mirroring Logic
      const mirroredNormX = 1 - idxTip.x;
      const rawX = (mirroredNormX * scaledW) + offsetX;
      const rawY = (idxTip.y * scaledH) + offsetY;

      // Smoothing
      smoothedPos.current.x = lerp(smoothedPos.current.x, rawX, 0.5);
      smoothedPos.current.y = lerp(smoothedPos.current.y, rawY, 0.5);

      const x = smoothedPos.current.x;
      const y = smoothedPos.current.y;

      // Pinch Detection
      const dist = Math.sqrt(
        Math.pow((1 - thumbTip.x) - (1 - idxTip.x), 2) + 
        Math.pow(thumbTip.y - idxTip.y, 2)
      );
      const isPinching = dist < 0.08;

      // Update Custom Cursor
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        cursorRef.current.style.borderColor = isPinching ? '#fff' : colorRef.current;
        cursorRef.current.style.width = isPinching ? `${20 + sizeRef.current}px` : '30px';
        cursorRef.current.style.height = isPinching ? `${20 + sizeRef.current}px` : '30px';
        
        const inner = cursorRef.current.querySelector('.cursor-inner');
        if(inner) {
            inner.style.backgroundColor = colorRef.current;
            inner.style.opacity = isPinching ? '1' : '0.5';
        }
      }

      // Drawing
      if (isPinching) {
        if (prevPoint.current) {
            const lineData = {
                x1: prevPoint.current.x / dstW,
                y1: prevPoint.current.y / dstH,
                x2: x / dstW,
                y2: y / dstH,
                color: colorRef.current,
                size: sizeRef.current
            };
            drawLine(lineData);

            const now = Date.now();
            if (now - lastEmitRef.current > 15) { 
                socket.emit("draw_line", { ...lineData, room: roomId });
                lastEmitRef.current = now;
            }
        }
        prevPoint.current = { x, y };
      } else {
        prevPoint.current = null;
      }
    } else {
      if (handDetected) setHandDetected(false);
      prevPoint.current = null;
    }
  };

  const startMediaPipe = async () => {
    if (!window.Hands) return;

    const hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    if (webcamRef.current) {
        const camera = new window.Camera(webcamRef.current, {
            onFrame: async () => {
                // --- INTEGRATION: Critical Safety Check ---
                // Prevents "Send on closed stream" errors
                if(
                    webcamRef.current && 
                    handsRef.current && 
                    webcamRef.current.readyState === 4 // 4 = HAVE_ENOUGH_DATA
                ) {
                    await handsRef.current.send({ image: webcamRef.current });
                }
            },
            width: 1280,
            height: 720
        });
        camera.start();
    }
  };

  if (!joined) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>

        <div className="max-w-md w-full bg-gray-800/80 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-gray-700 relative z-10 text-center">
            <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 mb-6">AIR CANVAS</h1>
            <div className="flex flex-col gap-4">
                <input 
                    type="text" 
                    placeholder="Enter Room ID" 
                    value={roomId} 
                    onChange={(e) => setRoomId(e.target.value)}
                    className="w-full bg-gray-900/50 border border-gray-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 outline-none"
                />
                <button 
                    onClick={() => roomId && setJoined(true)}
                    disabled={!roomId}
                    className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl font-bold hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg disabled:opacity-50"
                >
                    JOIN SESSION
                </button>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex items-center justify-center">
        
        {/* Custom Cursor */}
        <div 
            ref={cursorRef}
            className="fixed pointer-events-none z-[100] flex items-center justify-center transition-opacity duration-150"
            style={{ 
                left: 0, top: 0, 
                width: '30px', height: '30px',
                border: '2px solid rgba(255,255,255,0.5)',
                borderRadius: '50%',
                opacity: handDetected ? 1 : 0,
                willChange: 'transform' 
            }}
        >
            <div className="cursor-inner w-2 h-2 rounded-full bg-white transition-all duration-150"></div>
        </div>

        {/* Toolbar */}
        <div className="absolute top-6 z-[60] flex gap-4 items-center bg-gray-900/80 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/10 shadow-2xl">
            <div className="flex items-center gap-2 mr-4">
                <div className={`w-3 h-3 rounded-full ${handDetected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}></div>
                <span className="text-xs font-mono text-gray-400">ID: {roomId}</span>
            </div>

            <div className="flex gap-2 border-r border-white/10 pr-4">
                {COLORS.map((c) => (
                    <button 
                        key={c} 
                        onClick={() => setPenColor(c)} 
                        className={`w-6 h-6 rounded-full transition-all ${penColor === c ? 'scale-125 ring-2 ring-white' : 'opacity-60 hover:opacity-100'}`}
                        style={{ backgroundColor: c }}
                    />
                ))}
            </div>

            <div className="flex gap-2 items-center border-r border-white/10 pr-4">
                {SIZES.map((s) => (
                    <button 
                        key={s} 
                        onClick={() => setPenSize(s)}
                        className={`rounded-full bg-gray-600 transition-all ${penSize === s ? 'bg-white' : 'opacity-50'}`}
                        style={{ width: s * 1.5 + 4, height: s * 1.5 + 4 }}
                    />
                ))}
            </div>

            <div className="flex gap-3">
                <button onClick={clearCanvasAll} className="text-red-400 hover:text-red-300 transition-colors" title="Clear Canvas">
                    <FaEraser size={18} />
                </button>
                <button onClick={() => setMainView(v => v === 'local' ? 'remote' : 'local')} className="text-blue-400 hover:text-blue-300 transition-colors" title="Switch View">
                    <FaExchangeAlt size={18} />
                </button>
            </div>
        </div>

        <div ref={containerRef} className="relative w-full h-full">
            {/* View 1: Local (Self) */}
            <div 
                className={`view-transition overflow-hidden bg-black ${mainView === 'local' ? 'fullscreen-mode' : 'pip-mode'}`}
                onClick={() => mainView === 'remote' && setMainView('local')}
            >
                <video 
                    ref={webcamRef} 
                    className="w-full h-full object-cover mirror opacity-80" 
                    playsInline 
                    muted 
                    autoPlay
                />
                {mainView === 'remote' && <div className="absolute bottom-2 left-2 text-[10px] bg-black/60 px-2 rounded text-white">YOU</div>}
            </div>

            {/* View 2: Remote (Peer) */}
            <div 
                className={`view-transition overflow-hidden bg-gray-800 border-2 border-gray-700/50 ${mainView === 'remote' ? 'fullscreen-mode' : 'pip-mode'}`}
                onClick={() => mainView === 'local' && setMainView('remote')}
            >
                <video 
                    ref={remoteVideoRef} 
                    className="w-full h-full object-cover" 
                    playsInline 
                    autoPlay
                />
                
                <div className="absolute inset-0 flex items-center justify-center -z-10">
                    <div className="flex flex-col items-center opacity-30">
                        <FaUserFriends size={40} className="mb-2" />
                        <span className="text-xs">WAITING FOR PEER</span>
                    </div>
                </div>
                {mainView === 'local' && <div className="absolute bottom-2 left-2 text-[10px] bg-black/60 px-2 rounded text-white">PEER</div>}
            </div>

            {/* Canvas Layer */}
            <canvas 
                ref={canvasRef} 
                className="absolute inset-0 z-20 pointer-events-none touch-none"
            ></canvas>

        </div>
    </div>
  );
}

export default App;