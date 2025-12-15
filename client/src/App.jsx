import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";
const socket = io(SERVER_URL);

/* =======================
   HELPERS
======================= */
const lerp = (a, b, t) => a + (b - a) * t;

function App() {
  /* =======================
     REFS
  ======================= */
  const webcamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const contentWrapperRef = useRef(null);
  const peerRef = useRef(null);
  const handsRef = useRef(null);

  const prevPoint = useRef(null);
  const lastEmitRef = useRef(0);

  /* =======================
     STATE
  ======================= */
  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [mainView, setMainView] = useState("local"); // local | remote
  const [penSize] = useState(5);
  const [penColor] = useState("#ff4d4d");

  const colorRef = useRef(penColor);
  useEffect(() => (colorRef.current = penColor), [penColor]);

  /* =======================
     21:9 LAYOUT
  ======================= */
  const [outerContainerSize, setOuterContainerSize] = useState({
    width: 0,
    height: 0,
    top: 0,
    left: 0,
  });

  const cameraRatio = 16 / 9;
  const targetRatio = 21 / 9;

  useEffect(() => {
    const updateLayout = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let width = vw * 0.95;
      let height = width / targetRatio;

      if (height > vh * 0.85) {
        height = vh * 0.85;
        width = height * targetRatio;
      }

      setOuterContainerSize({
        width,
        height,
        left: (vw - width) / 2,
        top: (vh - height) / 2,
      });
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.width = outerContainerSize.width;
      canvasRef.current.height = outerContainerSize.height;
    }
  }, [outerContainerSize]);

  /* =======================
     PEER + SOCKET
  ======================= */
  useEffect(() => {
    if (!joined) return;

    const peer = new Peer(undefined, {
      host: "air-canvas-2sga.onrender.com",
      secure: true,
      port: 443,
      path: "/peerjs",
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      socket.emit("join_room", { room, peerId: id });
    });

    peer.on("call", (call) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((stream) => {
        call.answer(stream);
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });
      });
    });

    socket.on("user_connected", (peerId) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((stream) => {
        const call = peer.call(peerId, stream);
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });
      });
    });

    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      peer.destroy();
    };
  }, [joined]);

  /* =======================
     DRAWING
  ======================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = null;
      return;
    }

    const now = Date.now();
    if (now - lastEmitRef.current < 16) return;
    lastEmitRef.current = now;

    const lm = results.multiHandLandmarks[0];
    const index = lm[8];
    const thumb = lm[4];

    const pinch = Math.hypot(index.x - thumb.x, index.y - thumb.y);
    if (pinch > 0.08) {
      prevPoint.current = null;
      return;
    }

    const canvas = canvasRef.current;
    const w = canvas.width;
    const h = canvas.height;

    const x = (1 - index.x) * w;
    const y = index.y * h;

    if (prevPoint.current) {
      const nx = lerp(prevPoint.current.x, x, 0.3);
      const ny = lerp(prevPoint.current.y, y, 0.3);

      const payload = {
        room,
        x1: prevPoint.current.x / w,
        y1: prevPoint.current.y / h,
        x2: nx / w,
        y2: ny / h,
        color: colorRef.current,
        size: penSize,
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

    const w = canvasRef.current.width;
    const h = canvasRef.current.height;

    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1 * w, y1 * h);
    ctx.lineTo(x2 * w, y2 * h);
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  /* =======================
     UI
  ======================= */
  if (!joined) {
    return (
      <div className="join-screen">
        <h2>Air Canvas</h2>
        <input onChange={(e) => setRoom(e.target.value)} placeholder="Room ID" />
        <button onClick={() => setJoined(true)}>Start</button>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div
        ref={containerRef}
        className="canvas-container"
        style={outerContainerSize}
      >
        <canvas ref={canvasRef} className="drawing-canvas" />

        <div
          ref={contentWrapperRef}
          className="content-wrapper"
          style={{ aspectRatio: cameraRatio, height: "100%" }}
        >
          <div className="video-feed">
            {mainView === "local" ? (
              <Webcam ref={webcamRef} mirrored className="main-video" />
            ) : (
              <video ref={remoteVideoRef} autoPlay playsInline className="main-video" />
            )}
          </div>
        </div>
      </div>

      <button
        style={{ position: "fixed", bottom: 30, right: 30 }}
        onClick={() => setMainView(mainView === "local" ? "remote" : "local")}
      >
        Switch View
      </button>
    </div>
  );
}

export default App;
