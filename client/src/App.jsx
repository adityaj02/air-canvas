import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import io from "socket.io-client";
import Peer from "peerjs"; // Import PeerJS
import "./App.css";

const socket = io.connect("http://localhost:3001", {
  transports: ["websocket"],
});

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const remoteVideoRef = useRef(null); // Ref for Friend's Video
  
  // State
  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [myPeerId, setMyPeerId] = useState("");
  
  // Drawing State
  const prevPoint = useRef({ x: 0, y: 0 });
  const [color, setColor] = useState("#FF0000"); 
  const colorRef = useRef("#FF0000");

  useEffect(() => {
    if (!joined) return;

    // --- 1. Setup PeerJS (Video Call) ---
    const peer = new Peer(undefined, {
      host: "/",
      port: 3001, // We will setup PeerServer on backend next
      path: "/peerjs"
    });

    peer.on("open", (id) => {
      setMyPeerId(id);
      socket.emit("join_room", { room, peerId: id }); // Send PeerID to room
    });

    // Answer a call
    peer.on("call", (call) => {
      const stream = webcamRef.current.video.srcObject;
      call.answer(stream); // Answer with my stream
      call.on("stream", (userVideoStream) => {
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = userVideoStream;
        }
      });
    });

    // Listen for new user and call them
    socket.on("user_connected", (userId) => {
      connectToNewUser(userId, webcamRef.current.video.srcObject, peer);
    });

    // --- 2. Setup MediaPipe (Drawing) ---
    const Hands = window.Hands;
    const Camera = window.Camera;

    if (!Hands || !Camera) {
        console.error("MediaPipe scripts not loaded yet!");
        return;
    }

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(onResults);

    if (webcamRef.current && webcamRef.current.video) {
      const camera = new Camera(webcamRef.current.video, {
        onFrame: async () => {
          if (webcamRef.current && webcamRef.current.video) {
            await hands.send({ image: webcamRef.current.video });
          }
        },
        width: 640,
        height: 480,
      });
      camera.start();
    }

    // Drawing Listeners
    socket.on("receive_draw", (data) => {
        drawLine(data.x1, data.y1, data.x2, data.y2, data.color);
    });
    socket.on("clear_canvas", () => clearCanvasLocal());

    return () => { 
        socket.off("receive_draw");
        socket.off("clear_canvas");
        socket.off("user_connected");
        peer.destroy();
    };
  }, [joined]);

  // Helper to call new user
  const connectToNewUser = (userId, stream, peer) => {
    const call = peer.call(userId, stream);
    call.on("stream", (userVideoStream) => {
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = userVideoStream;
        }
    });
  };

  const changeColor = (newColor) => {
    setColor(newColor);
    colorRef.current = newColor;
  };

  const drawLine = (x1, y1, x2, y2, strokeColor) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = strokeColor;
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
    if (!canvasRef.current) return;
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      const indexFinger = landmarks[8];
      const x = (1 - indexFinger.x) * width; 
      const y = indexFinger.y * height;
      const indexUp = indexFinger.y < landmarks[6].y;
      const middleUp = landmarks[12].y < landmarks[10].y;

      if (indexUp && !middleUp) {
        if (prevPoint.current.x === 0 && prevPoint.current.y === 0) {
           prevPoint.current = { x, y };
        } else {
           const currentColor = colorRef.current;
           drawLine(prevPoint.current.x, prevPoint.current.y, x, y, currentColor);
           socket.emit("draw_line", {
               room,
               x1: prevPoint.current.x,
               y1: prevPoint.current.y,
               x2: x,
               y2: y,
               color: currentColor
           });
           prevPoint.current = { x, y };
        }
      } else {
          prevPoint.current = { x: 0, y: 0 };
      }
    }
  };

  const joinRoom = () => {
    if (room !== "") setJoined(true);
  };

  return (
    <div className="App" style={{textAlign: "center"}}>
      {!joined ? (
        <div style={{marginTop: "50px"}}>
          <h2>Join Video Room</h2>
          <input type="text" placeholder="Room ID..." onChange={(e) => setRoom(e.target.value)} />
          <button onClick={joinRoom}>Join</button>
        </div>
      ) : (
        <div className="main-container">
          <h2>Room: {room} | <button onClick={broadcastClear}>Clear</button></h2>
          
          <div className="videos-container" style={{display: "flex", justifyContent: "center", gap: "20px"}}>
            {/* MY CANVAS & VIDEO */}
            <div className="canvas-container" style={{position: "relative", width: 640, height: 480}}>
               <Webcam ref={webcamRef} className="input_video" width={640} height={480} />
               <canvas ref={canvasRef} className="output_canvas" width={640} height={480} />
               <p style={{position: "absolute", bottom: 0, left: 10, color: "white", fontWeight: "bold"}}>YOU</p>
            </div>

            {/* FRIEND'S VIDEO */}
            <div className="remote-video" style={{width: 640, height: 480, backgroundColor: "black"}}>
               <video ref={remoteVideoRef} autoPlay playsInline style={{width: "100%", height: "100%", transform: "scaleX(-1)"}} />
               <p style={{color: "white"}}>FRIEND</p>
            </div>
          </div>
          
          <div style={{marginTop: "10px"}}>
             <button onClick={() => changeColor("red")} style={{backgroundColor:"red", width:30, height:30}}></button>
             <button onClick={() => changeColor("blue")} style={{backgroundColor:"blue", width:30, height:30}}></button>
             <button onClick={() => changeColor("green")} style={{backgroundColor:"green", width:30, height:30}}></button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;