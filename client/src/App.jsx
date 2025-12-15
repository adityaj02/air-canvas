import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";
const socket = io(SERVER_URL);

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState("guest"); // host | guest
  const [penColor, setPenColor] = useState("#ff4d4d");

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
            remoteVideoRef.current.srcObject = remoteStream;
          });
        });
    });

    socket.on("user_connected", (peerId) => {
      setRole("host");          // first user becomes host
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
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    const camera = new window.Camera(webcamRef.current.video, {
      onFrame: async () => {
        await hands.send({ image: webcamRef.current.video });
      },
      width: 640,
      height: 480,
    });

    camera.start();
  };

  /* =========================
     DRAWING
  ========================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    const now = Date.now();
    if (now - lastEmitRef.current < 25) return;
    lastEmitRef.current = now;

    const index = results.multiHandLandmarks[0][8];
    const x = (1 - index.x) * canvasRef.current.width;
    const y = index.y * canvasRef.current.height;

    if (prevPoint.current.x !== 0) {
      const payload = {
        room,
        x1: prevPoint.current.x,
        y1: prevPoint.current.y,
        x2: x,
        y2: y,
        color: colorRef.current,
      };

      drawLine(payload);
      socket.emit("draw_line", payload);
    }

    prevPoint.current = { x, y };
  };

  const drawLine = ({ x1, y1, x2, y2, color }) => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke();
  };

  const clearCanvasLocal = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const callUser = (peerId) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        const call = peerRef.current.call(peerId, stream);
        call.on("stream", (remoteStream) => {
          remoteVideoRef.current.srcObject = remoteStream;
        });
      });
  };

  /* =========================
     JOIN SCREEN
  ========================= */
  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h2>Air Canvas</h2>
          <input placeholder="Enter Room ID" onChange={(e) => setRoom(e.target.value)} />
          <button onClick={() => setJoined(true)}>Start</button>
        </div>
      </div>
    );
  }

  /* =========================
     UI
  ========================= */
  return (
    <div className="main-container">

      <div className="top-bar">
        <div className="logo">Air Canvas</div>
        <div className="right">
          <input type="color" value={penColor}
            onChange={(e) => setPenColor(e.target.value)}
            className="color-picker" />
        </div>
      </div>

      <div className="stage">
        {/* MAIN */}
        <div className="stage-main">
          {role === "host"
            ? <video ref={remoteVideoRef} autoPlay playsInline className="stage-video" />
            : <>
                <Webcam ref={webcamRef} mirrored className="stage-video" />
                <canvas ref={canvasRef} width={640} height={480} className="canvas" />
              </>
          }
          <span className="stage-label">{role === "host" ? "FRIEND" : "ME"}</span>
        </div>

        {/* PIP */}
        <div className="stage-pip">
          {role === "host"
            ? <>
                <Webcam ref={webcamRef} mirrored className="pip-video" />
                <canvas ref={canvasRef} width={640} height={480} className="canvas pip-canvas" />
              </>
            : <video ref={remoteVideoRef} autoPlay playsInline className="pip-video" />
          }
          <span className="pip-label">{role === "host" ? "ME" : "FRIEND"}</span>
        </div>
      </div>

      <footer className="footer">
        Powered by <span>Starx Labs</span>
      </footer>
    </div>
  );
}

export default App;
