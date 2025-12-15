// ... (imports and initial setup remain unchanged) ...

function App() {
  // ... (existing state and refs remain unchanged) ...

  // Add a new ref for the canvas container (if not already present)
  const containerRef = useRef(null);

  // ... (colorOptions, penSizes, etc., remain unchanged) ...

  /* =======================
      RESIZE HANDLER (Calculates 21:9 Box) - Unchanged
  ======================= */
  useEffect(() => {
    const updateLayout = () => {
      // ... (your existing updateLayout logic remains unchanged) ...
    };
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  /* =======================
      UPDATE CANVAS SIZE ON RESIZE
  ======================= */
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.width = outerContainerSize.width;
      canvasRef.current.height = outerContainerSize.height;
    }
  }, [outerContainerSize]);

  // ... (handleVideoLoad, connection setup, startMediaPipe remain unchanged) ...

  /* =======================
      DRAWING LOGIC - Updated for full 21:9 canvas and normalized coords
  ======================= */
  const onResults = (results) => {
    if (!results.multiHandLandmarks?.length) {
      prevPoint.current = null;
      setIsDrawing(false);
      return;
    }

    // Rate Limit - Unchanged
    const now = Date.now();
    if (now - lastEmitRef.current < 16) return;
    lastEmitRef.current = now;

    const lm = results.multiHandLandmarks[0];
    const index = lm[8]; 
    const thumb = lm[4]; 

    // Pinch Detection - Unchanged
    const pinch = Math.hypot(index.x - thumb.x, index.y - thumb.y);
    if (pinch > 0.08) {
      prevPoint.current = null;
      setIsDrawing(false);
      return;
    }

    setIsDrawing(true);
    
    // MAPPING: Now to the full canvas size (21:9)
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.width;
    const height = canvas.height;
    
    // Mirror X coordinate
    const x = (1 - index.x) * width;
    const y = index.y * height;

    if (prevPoint.current) {
      const nx = lerp(prevPoint.current.x, x, 0.3);
      const ny = lerp(prevPoint.current.y, y, 0.3);

      // Emit normalized coordinates (0-1 scale for cross-device compatibility)
      const payload = {
        room,
        x1: prevPoint.current.x / width,
        y1: prevPoint.current.y / height,
        x2: nx / width,
        y2: ny / height,
        color: colorRef.current,
        size: penSize
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
    
    // Scale normalized coords back to local canvas size
    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.strokeStyle = color;
    ctx.lineWidth = size || penSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x1 * width, y1 * height);
    ctx.lineTo(x2 * width, y2 * height);
    ctx.stroke();
  };

  // ... (clearCanvasLocal, callUser, switchView remain unchanged) ...

  /* =======================
      UI RENDER - Updated JSX structure
  ======================= */
  // ... (join screen remains unchanged) ...

  return (
    <div className="app-container">
      // ... (connection status remains unchanged) ...

      {/* 21:9 OUTER CONTAINER */}
      <div 
        ref={containerRef}
        className="canvas-container"
        style={{
          width: outerContainerSize.width,
          height: outerContainerSize.height,
          top: outerContainerSize.top,
          left: outerContainerSize.left
        }}
      >
        {/* CANVAS: Now covers the full 21:9 area as a shared overlay */}
        <canvas 
          ref={canvasRef} 
          className="drawing-canvas" 
          // width/height set dynamically in useEffect
        />
        
        {/* INNER WRAPPER: Only for video centering */}
        <div 
          ref={contentWrapperRef}
          className="content-wrapper"
          style={{ 
            aspectRatio: `${cameraRatio}`,
            height: '100%',
            margin: '0 auto', // Centers horizontally
            position: 'relative'
          }}
        >
          <div className="video-feed">
            {mainView === "local" ? (
              <Webcam 
                ref={webcamRef} 
                mirrored 
                className="main-video"
                onUserMedia={handleVideoLoad}
              />
            ) : (
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                className="main-video"
              />
            )}
          </div>
        </div>
        <div className="container-glow"></div>
      </div>

      // ... (control-panel, drawing-status, invite modal remain unchanged) ...
    </div>
  );
}

export default App;
