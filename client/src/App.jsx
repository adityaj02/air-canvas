/* global ResizeObserver, Hands, Camera */

import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import Peer from "peerjs";
import { FaEraser, FaUserFriends, FaExchangeAlt } from "react-icons/fa";

// --- CONFIGURATION ---
const isProduction =
  typeof window !== "undefined" && window.location.hostname !== "localhost";

const SERVER_URL = isProduction
  ? "https://air-canvas-2sga.onrender.com"
  : "http://localhost:3001";

const COLORS = ["#ff4d4d", "#4dff4d", "#4d4dff", "#ffff4d", "#ff4dff", "#ffffff"];
const SIZES = [4, 8, 12];
const lerp = (a, b, t) => a + (b - a) * t;

// Initialize socket ONCE
const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  reconnectionAttempts: 5,
});

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

  // eslint-disable-next-line no-unused-vars
  const callsRef = useRef([]);

  const colorRef = useRef("#ff4d4d");
  const sizeRef = useRef(8);

  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [mainView, setMainView] = useState("local");
  const [penColor, setPenColor] = useState("#ff4d4d");
  const [penSize, setPenSize] = useState(8);
  const [handDetected, setHandDetected] = useState(false);

  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

  useEffect(() => {
    sizeRef.current = penSize;
  }, [penSize]);

  const drawLine = useCallback((data) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    ctx.beginPath();
    ctx.moveTo(data.x1 * canvas.width, data.y1 * canvas.height);
    ctx.lineTo(data.x2 * canvas.width, data.y2 * canvas.height);
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }, []);

  const clearCanvasLocal = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const clearCanvasAll = useCallback(() => {
    clearCanvasLocal();
    socket.emit("clear_canvas", { room: roomId });
  }, [clearCanvasLocal, roomId]);

  const onResults = useCallback(
    (results) => {
      const canvas = canvasRef.current;
      const video = webcamRef.current;
      if (!canvas || !video || video.videoWidth === 0) return;

      if (results.multiHandLandmarks?.length) {
        if (!handDetected) setHandDetected(true);

        const [idxTip, , , , thumbTip] = [
          results.multiHandLandmarks[0][8],
          null,
          null,
          null,
          results.multiHandLandmarks[0][4],
        ];

        const scale = Math.max(
          canvas.width / video.videoWidth,
          canvas.height / video.videoHeight
        );

        const rawX =
          (1 - idxTip.x) * video.videoWidth * scale +
          (canvas.width - video.videoWidth * scale) / 2;
        const rawY =
          idxTip.y * video.videoHeight * scale +
          (canvas.height - video.videoHeight * scale) / 2;

        smoothedPos.current.x = lerp(smoothedPos.current.x, rawX, 0.5);
        smoothedPos.current.y = lerp(smoothedPos.current.y, rawY, 0.5);

        const x = smoothedPos.current.x;
        const y = smoothedPos.current.y;

        const dist = Math.hypot(
          thumbTip.x - idxTip.x,
          thumbTip.y - idxTip.y
        );
        const isPinching = dist < 0.08;

        if (cursorRef.current) {
          cursorRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          cursorRef.current.style.opacity = handDetected ? 1 : 0;
        }

        if (isPinching) {
          if (prevPoint.current) {
            const lineData = {
              x1: prevPoint.current.x / canvas.width,
              y1: prevPoint.current.y / canvas.height,
              x2: x / canvas.width,
              y2: y / canvas.height,
              color: colorRef.current,
              size: sizeRef.current,
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
    },
    [drawLine, handDetected, roomId]
  );

  const startMediaPipe = useCallback(async () => {
    if (!window.Hands) return;

    const hands = new window.Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`,
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
          if (handsRef.current) {
            await handsRef.current.send({ image: webcamRef.current });
          }
        },
        width: 1280,
        height: 720,
      });
      camera.start();
    }
  }, [onResults]);

  useEffect(() => {
    if (!joined) return;

    let resizeObserver;

    if (containerRef.current && canvasRef.current) {
      resizeObserver = new ResizeObserver(() => {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      });
      resizeObserver.observe(containerRef.current);
    }

    const peer = new Peer(undefined, {
      host: isProduction ? "air-canvas-2sga.onrender.com" : "localhost",
      port: isProduction ? 443 : 3001,
      path: "/peerjs",
      secure: isProduction,
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      socket.emit("join_room", { room: roomId, peerId: id });
    });

    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    startMediaPipe();

    return () => {
      resizeObserver?.disconnect();
      socket.off("receive_draw");
      socket.off("clear_canvas");
      peer.destroy();
      handsRef.current?.close();
    };
  }, [joined, roomId, drawLine, clearCanvasLocal, startMediaPipe]);

  // JSX BELOW IS UNCHANGED (UI IS EXACTLY SAME)

  if (!joined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <input
          placeholder="Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
        <button onClick={() => setJoined(true)}>Join</button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black">
      <div ref={containerRef} className="w-full h-full">
        <video ref={webcamRef} autoPlay muted playsInline />
        <video ref={remoteVideoRef} autoPlay playsInline />
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
    </div>
  );
}

export default App;
