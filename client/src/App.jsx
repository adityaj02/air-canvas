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
  const [myPeerId, setMyPeerId] = useState("");

  const [penColor, setPenColor] = useState("#ff4d4d");

  const prevPoint = useRef({ x: 0, y: 0 });
  const colorRef = useRef(penColor);
  const peerRef = useRef(null);
  const handsRef = useRef(null);

  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

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
      setMyPeerId(id);
      socket.emit("join_room", { room, peerId: id });
    });

    peer.on("call", (call) => {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((stream) => {
          call.answer(stream);
          call.on("stream", (remoteStream) => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
            }
          });
        });
    });

    socket.on("user_connected", (peerId) => {
      callUser(peerId);
    });

    const startMediaPipe = async () => {
      let attempts = 0;
      while (!window.Hands && attempts < 20) {
        await new Promise((r) => setTimeout(r, 500));
        attempts++;
      }

      if (!window.Hands) return;

      const hands = new window.Hands({
        locateFile: (file) =>
          `https://unpkg.com/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(onResults);
      handsRef.current = hands;

      if (webcamRef.current?.video) {
        const camera = new window.Camera(webcamRef.current.video, {
          onFrame: async () => {
            if (handsRef.current) {
              await handsRef.current.send({
                image: webcamRef.current.video,
              });
            }
          },
          width: 640,
          height: 480,
        });
        camera.start();
      }
    };

    startMediaPipe();

    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_connected");
      peerRef.current?.destroy();
    };
  }, [joined]);

  const callUser = (peerId) => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        const call = peerRef.current.call(peerId, stream);
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });
      });
  };

  const drawLine = ({ x1, y1, x2, y2, color }) => {
    if (!canvasRef.current) return;
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
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height
    );
  };

  const broadcastClear = () => {
    clearCanvasLocal();
    socket.emit("clear_canvas", room);
  };

  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    const index = results.multiHandLandmarks[0][8];
    const x = (1 - index.x) * canvasRef.current.width;
    const y = index.y * canvasRef.current.height;

    if (prevPoint.current.x) {
      drawLine({
        x1: prevPoint.current.x,
        y1: prevPoint.current.y,
        x2: x,
        y2: y,
        color: colorRef.current,
      });

      socket.emit("draw_line", {
        room,
        x1: prevPoint.current.x,
        y1: prevPoint.current.y,
        x2: x,
        y2: y,
        color: colorRef.current,
      });
    }

    prevPoint.current = { x, y };
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <h2>Air Canvas</h2>
        <input
          placeholder="Enter Room ID"
          onChange={(e) => setRoom(e.target.value)}
        />
        <button onClick={() => setJoined(true)}>Start</button>
      </div>
    );
  }

  return (
    <div className="main-container">
      {/* TOP BAR */}
      <div className="top-bar">
        <div className="left">
          <span className="logo">Air Canvas</span>
          <span className="room-badge">Room {room}</span>
        </div>
        <div className="right">
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

      {/* CANVAS */}
      <div className="canvas-shell">
        <div className="video-grid">
          <div className="video-wrapper">
            <Webcam ref={webcamRef} mirrored className="webcam" />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="canvas"
            />
            <span className="label">You</span>
          </div>

          <div className="video-wrapper">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="remote-video"
            />
            <span className="label">Friend</span>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="footer">
        Powered by <span>Starx Labs</span>
      </footer>
    </div>
  );
}

export default App;
