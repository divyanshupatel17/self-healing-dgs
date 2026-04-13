import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Video } from "lucide-react";
import type { DetectedObject, PipelineFrameMessage } from "@/lib/detection";
import { PipelineSocket } from "@/lib/pipelineSocket";

interface CameraPanelProps {
  isRunning: boolean;
  healingEnabled: boolean;
  detectionLevel: number;
  detectedObjects: DetectedObject[];
  onFrameMessage: (message: PipelineFrameMessage) => void;
  onVideoLoaded?: () => void;
}

const DETECTION_COLOR = "#66b3ff";

const CameraPanel = ({
  isRunning,
  healingEnabled,
  detectionLevel,
  detectedObjects,
  onFrameMessage,
  onVideoLoaded,
}: CameraPanelProps) => {
  const canvasTopRef = useRef<HTMLCanvasElement>(null);
  const canvasBottomRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<number>(0);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<PipelineSocket | null>(null);
  const frameRef = useRef(0);
  const drawFrameRef = useRef(0);
  const lastSentAtRef = useRef(0);
  const objectsRef = useRef<DetectedObject[]>([]);
  const topImageRef = useRef<HTMLImageElement>(new Image());
  const bottomImageRef = useRef<HTMLImageElement>(new Image());

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const [socketStatus, setSocketStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    objectsRef.current = detectedObjects;
  }, [detectedObjects]);

  useEffect(() => {
    if (!offscreenRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 200;
      offscreenRef.current = canvas;
    }
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      alert("Please upload a video file.");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setVideoSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextUrl;
    });
    setVideoName(file.name);
    onVideoLoaded?.();
  }, [onVideoLoaded]);

  useEffect(() => {
    const socket = new PipelineSocket({
      onFrame: (message) => {
        topImageRef.current.src = message.raw_frame;
        bottomImageRef.current.src = message.healed_frame;
        onFrameMessage(message);
      },
      onStatus: setSocketStatus,
    });

    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [onFrameMessage]);

  useEffect(() => {
    if (!isRunning || !videoSrc) {
      cancelAnimationFrame(animRef.current);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const tick = () => {
      const topCanvas = canvasTopRef.current;
      const bottomCanvas = canvasBottomRef.current;
      if (!topCanvas || !bottomCanvas) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      const topCtx = topCanvas.getContext("2d");
      const bottomCtx = bottomCanvas.getContext("2d");
      if (!topCtx || !bottomCtx) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      drawFrameRef.current += 1;
      const now = performance.now();
      const targetInterval = 1000 / 24;
      const canSend = now - lastSentAtRef.current >= targetInterval;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && canSend && socketRef.current?.isConnected()) {
        const capture = offscreenRef.current;
        const captureCtx = capture?.getContext("2d");
        if (capture && captureCtx) {
          captureCtx.drawImage(video, 0, 0, capture.width, capture.height);
          frameRef.current += 1;
          socketRef.current.sendFrame({
            frame_id: frameRef.current,
            image: capture.toDataURL("image/jpeg", 0.72),
            healing_enabled: healingEnabled,
            detection_level: detectionLevel,
          });
          lastSentAtRef.current = now;
        }
      }

      drawFeed(topCtx, topCanvas.width, topCanvas.height, topImageRef.current, video, objectsRef.current);
      drawFeed(bottomCtx, bottomCanvas.width, bottomCanvas.height, bottomImageRef.current, video, objectsRef.current);
      animRef.current = requestAnimationFrame(tick);
    };

    video.play().catch(() => {});
    animRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animRef.current);
      video.pause();
    };
  }, [isRunning, videoSrc, healingEnabled, detectionLevel]);

  useEffect(() => {
    if (!isRunning && videoRef.current) videoRef.current.pause();
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning || videoSrc) return;

    const drawFallback = () => {
      drawFrameRef.current += 1;
      const objects = objectsRef.current;
      const topCtx = canvasTopRef.current?.getContext("2d");
      const bottomCtx = canvasBottomRef.current?.getContext("2d");

      if (topCtx && canvasTopRef.current) {
        drawRoadScene(topCtx, canvasTopRef.current.width, canvasTopRef.current.height, drawFrameRef.current);
        drawAllBBoxes(topCtx, canvasTopRef.current.width, canvasTopRef.current.height, objects);
      }
      if (bottomCtx && canvasBottomRef.current) {
        drawRoadScene(bottomCtx, canvasBottomRef.current.width, canvasBottomRef.current.height, drawFrameRef.current);
        drawAllBBoxes(bottomCtx, canvasBottomRef.current.width, canvasBottomRef.current.height, objects);
      }

      animRef.current = requestAnimationFrame(drawFallback);
    };

    animRef.current = requestAnimationFrame(drawFallback);
    return () => cancelAnimationFrame(animRef.current);
  }, [isRunning, videoSrc]);

  useEffect(() => {
    return () => {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
    };
  }, [videoSrc]);

  return (
    <div className="panel-glass h-full flex flex-col">
      <div className="panel-header flex items-center justify-between">
        <span>Camera + Detection</span>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-medium ${socketStatus === "connected" ? "text-[#22c55e]" : socketStatus === "connecting" ? "text-yellow-400" : "text-[#ef4444]"}`}>
            WS: {socketStatus}
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer text-primary hover:text-primary/80 transition-colors">
            <Upload className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium normal-case tracking-normal">Upload Video</span>
            <input type="file" accept="video/*" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      </div>

      {videoSrc && <video ref={videoRef} src={videoSrc} muted loop playsInline className="hidden" crossOrigin="anonymous" />}

      {videoName && (
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-primary bg-primary/5 border-b border-border">
          <Video className="w-3 h-3" />
          <span className="truncate">{videoName}</span>
        </div>
      )}

      <div className="flex-1 flex flex-col gap-1 p-2">
        <div className="flex-1 relative">
          <div className="text-xs text-muted-foreground px-2 py-1">Front Camera Feed</div>
          <canvas ref={canvasTopRef} width={480} height={200} className="w-full h-full object-cover rounded-sm bg-muted/20" />
          {!videoSrc && !isRunning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Upload a video or click Start</p>
            </div>
          )}
        </div>

        <div className="flex-1 relative">
          <div className="text-xs text-muted-foreground px-2 py-1">Visibility Enhanced Feed</div>
          <canvas ref={canvasBottomRef} width={480} height={200} className="w-full h-full object-cover rounded-sm bg-muted/20" />
        </div>

        {isRunning && (
          <div className="flex gap-3 px-2 py-1 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#66b3ff]" />Object Detection</span>
          </div>
        )}
      </div>
    </div>
  );
};

function drawAllBBoxes(ctx: CanvasRenderingContext2D, w: number, h: number, objects: DetectedObject[]) {
  for (const obj of objects) {
    const bx = obj.bbox.x * w;
    const by = obj.bbox.y * h;
    const bw = obj.bbox.w * w;
    const bh = obj.bbox.h * h;

    ctx.strokeStyle = DETECTION_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    const cl = 8;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx, by + cl); ctx.lineTo(bx, by); ctx.lineTo(bx + cl, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + bw - cl, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cl); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by + bh - cl); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cl, by + bh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + bw - cl, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cl); ctx.stroke();

    const labelText = `${obj.label.toUpperCase()} ${obj.confidence}%`;
    ctx.font = "bold 9px monospace";
    const tm = ctx.measureText(labelText);
    ctx.fillStyle = DETECTION_COLOR;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bx, by - 12, tm.width + 6, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillText(labelText, bx + 3, by - 3);
  }
}

function drawFeed(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  processedImage: HTMLImageElement,
  fallbackVideo: HTMLVideoElement,
  objects: DetectedObject[]
) {
  if (processedImage.src && processedImage.complete && processedImage.naturalWidth > 0) {
    ctx.drawImage(processedImage, 0, 0, w, h);
  } else if (fallbackVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    ctx.drawImage(fallbackVideo, 0, 0, w, h);
  } else {
    ctx.fillStyle = "#101826";
    ctx.fillRect(0, 0, w, h);
  }
  drawAllBBoxes(ctx, w, h, objects);
}

function drawRoadScene(ctx: CanvasRenderingContext2D, w: number, h: number, frame: number) {
  ctx.fillStyle = "rgba(180, 185, 195, 0.35)";
  ctx.fillRect(0, 0, w, h);
  const horizon = h * 0.45;
  ctx.fillStyle = "#4a4a50";
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(w, horizon);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  const offset = (frame * 3) % 40;
  for (let y = horizon; y < h; y += 40) {
    const progress = (y - horizon) / (h - horizon);
    const cx = w / 2;
    const spread = progress * w * 0.3;
    const dashY = y + offset * progress;
    if (dashY < h) {
      ctx.beginPath();
      ctx.moveTo(cx - spread, dashY);
      ctx.lineTo(cx - spread, Math.min(dashY + 15, h));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + spread, dashY);
      ctx.lineTo(cx + spread, Math.min(dashY + 15, h));
      ctx.stroke();
    }
  }
}

export default CameraPanel;
