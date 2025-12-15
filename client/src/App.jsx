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

  const prevPoint = useRef(null);
  const peerRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const colorRef = useRef(penColor);
  const lastEmitRef = useRef(0);

  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

  /* =======================
      FULLSCREEN CANVAS
  ======================= */
  useEffect(() => {
    const resize = () => {
      if (!canvasRef.current) return;
      canvasRef.current.width = window.innerWidth;
      canvasRef.current.height = window.innerHeight;
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
    while (!window.Hands) await new Promise(r => setTimeout(r, 300));

    const hands = new window.Hands({
      locateFile: (f) => `https://unpkg.com/@mediapipe/hands/${f}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    const camera = new window.Camera(webcamRef.current.video, {
      onFrame: async () => {
        await hands.send({ image: webcamRef.current.video });
      },
      width: 1280,
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
      return;
    }

    const now = Date.now();
    if (now - lastEmitRef.current < 15) return;
    lastEmitRef.current = now;

    const lm = results.multiHandLandmarks[0];
    const index = lm[8];
    const thumb = lm[4];

    const pinch = Math.hypot(index.x - thumb.x, index.y - thumb.y);
    if (pinch > 0.08) {
      prevPoint.current = null;
      return;
    }

    const x = (1 - index.x) * window.innerWidth;
    const y = index.y * window.innerHeight;

    if (prevPoint.current) {
      const nx = lerp(prevPoint.current.x, x, 0.25);
      const ny = lerp(prevPoint.current.y, y, 0.25);

      const payload = {
        room,
        x1: prevPoint.current.x,
        y1: prevPoint.current.y,
        x2: nx,
        y2: ny,
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
    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const callUser = (peerId) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      peerRef.current.call(peerId, stream).on("stream", setRemoteStreamObj);
    });
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h2>Air Canvas</h2>
          <input placeholder="Room ID" onChange={(e) => setRoom(e.target.value)} />
          <button onClick={() => setJoined(true)}>Start</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <canvas ref={canvasRef} className="canvas-overlay" />
      {mainView === "local" ? (
        <Webcam ref={webcamRef} mirrored className="main-video-feed" />
      ) : (
        <video ref={remoteVideoRef} autoPlay playsInline className="main-video-feed" />
      )}
    </>
  );
}

export default App;
