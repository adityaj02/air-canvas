import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs";
import "./App.css";

const SERVER_URL = "https://air-canvas-2sga.onrender.com";

const socket = io(SERVER_URL, {
  transports: ["websocket"],
});

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [myPeerId, setMyPeerId] = useState("");

  const prevPoint = useRef({ x: 0, y: 0 });
  const colorRef = useRef("#FF0000"); // Default Red
  const peerRef = useRef(null);
  const handsRef = useRef(null); // Keep track of Hands instance
  const cameraRef = useRef(null); // Keep track of Camera instance

  useEffect(() => {
    if (!joined) return;

    // --- 1. SETUP PEERJS (VIDEO CALLING) ---
    const peer = new Peer(undefined, {
      host: "air-canvas-2sga.onrender.com",
      port: 443,
      secure: true,
      path: "/peerjs",
    });

    peerRef.current = peer;

    peer.on("open", (id) => {
      console.log("My Peer ID:", id);
      setMyPeerId(id);
      socket.emit("join_room", { room, peerId: id });
    });

    // Answer incoming calls
    peer.on("call", (call) => {
      console.log("Receiving call...");
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          call.answer(stream);
          call.on("stream", (remoteStream) => {
            console.log("Stream received!");
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
            }
          });
        });
    });

    socket.on("user_connected", (peerId) => {
      console.log("New user connected:", peerId);
      callUser(peerId);
    });

    // --- 2. SETUP MEDIAPIPE (AIR WRITING) WITH RETRY LOGIC ---
    const startMediaPipe = async () => {
      // Wait for window.Hands to be available (checks 20 times)
      let attempts = 0;
      while (!window.Hands && attempts < 20) {
        console.log("Waiting for MediaPipe scripts to load...");
        await new Promise(r => setTimeout(r, 500)); // Wait 0.5s
        attempts++;
      }

      if (!window.Hands) {
        console.error("MediaPipe failed to load. Check index.html scripts.");
        return;
      }

      console.log("MediaPipe Loaded! Starting Hands...");

      const hands = new window.Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(onResults);
      handsRef.current = hands;

      if (webcamRef.current && webcamRef.current.video) {
        const camera = new window.Camera(webcamRef.current.video, {
          onFrame: async () => {
            if (webcamRef.current?.video && handsRef.current) {
               await handsRef.current.send({ image: webcamRef.current.video });
            }
          },
          width: 640,
          height: 480,
        });
        camera.start();
        cameraRef.current = camera;
      }
    };

    startMediaPipe();

    // --- 3. SOCKET DRAWING EVENTS ---
    socket.on("receive_draw", drawLine);
    socket.on("clear_canvas", clearCanvasLocal);

    // CLEANUP
    return () => {
      socket.off("receive_draw");
      socket.off("clear_canvas");
      socket.off("user_connected");
      if (peerRef.current) peerRef.current.destroy();
      // Stop camera if component unmounts
      // (Optional depending on library behavior)
    };
  }, [joined]);

  // --- HELPER FUNCTIONS ---

  const callUser = (peerId) => {
    console.log("Calling user:", peerId);
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        const call = peerRef.current.call(peerId, stream);
        call.on("stream", (remoteStream) => {
            console.log("Remote stream received (Caller)");
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
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const broadcastClear = () => {
    clearCanvasLocal();
    socket.emit("clear_canvas", room);
  };

  const onResults = (results) => {
    // Only clear if you want non-permanent trails
    // const ctx = canvasRef.current.getContext("2d");
    // ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = { x: 0, y: 0 };
      return;
    }

    const hand = results.multiHandLandmarks[0];
    const index = hand[8]; // Index finger tip

    // Mirror logic
    const x = (1 - index.x) * canvasRef.current.width;
    const y = index.y * canvasRef.current.height;

    // Start drawing only if we have a previous point
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
        <h2>Air Canvas Join</h2>
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
      <div className="controls">
        <h3>Room: {room}</h3>
        <button onClick={broadcastClear} className="clear-btn">Clear Board</button>
      </div>

      <div className="video-grid">
        <div className="video-wrapper local">
          <Webcam ref={webcamRef} mirrored={true} className="webcam" />
          <canvas ref={canvasRef} width={640} height={480} className="canvas" />
          <p className="label">You</p>
        </div>
        <div className="video-wrapper remote">
          <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
          <p className="label">Friend</p>
        </div>
      </div>
    </div>
  );
}

export default App;