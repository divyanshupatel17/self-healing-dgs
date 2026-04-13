import { useEffect, useRef } from "react";
import type { FrameData, ObjectLabel } from "@/lib/detection";

interface MetricsPanelProps {
  isRunning: boolean;
  healingEnabled: boolean;
  detectionLevel: number;
  frameData: FrameData | null;
}

const LABEL_ICONS: Record<ObjectLabel, string> = {
  car: "🚗",
  truck: "🚛",
  bus: "🚌",
  person: "🚶",
  bike: "🚲",
  motorcycle: "🏍️",
};

const MetricsPanel = ({ isRunning, healingEnabled, detectionLevel, frameData }: MetricsPanelProps) => {
  const sparkRefs = {
    fps: useRef<HTMLCanvasElement>(null),
    latency: useRef<HTMLCanvasElement>(null),
    slam: useRef<HTMLCanvasElement>(null),
    confidence: useRef<HTMLCanvasElement>(null),
  };

  const historyRef = useRef({
    fps: Array(40).fill(60),
    latency: Array(40).fill(18),
    slam: Array(40).fill(99),
    confidence: Array(40).fill(95),
  });

  const m = frameData?.metrics;

  useEffect(() => {
    if (!isRunning || !m) return;
    const h = historyRef.current;
    h.fps.push(m.fps); h.fps.shift();
    h.latency.push(m.latency); h.latency.shift();
    h.slam.push(m.slamAccuracy); h.slam.shift();
    h.confidence.push(m.avgConfidence); h.confidence.shift();

    drawSparkline(sparkRefs.fps.current, h.fps, 54, 64);
    drawSparkline(sparkRefs.latency.current, h.latency, 10, 30);
    drawSparkline(sparkRefs.slam.current, h.slam, 97, 100);
    drawSparkline(sparkRefs.confidence.current, h.confidence, 60, 100);
  }, [m, isRunning]);

  return (
    <div className="panel-glass h-full flex flex-col">
      <div className="panel-header">System Metrics</div>
      <div className="flex-1 flex flex-col gap-3 p-3 overflow-auto text-sm">
        <MetricItem label="FPS" value={m ? `${m.fps}` : "—"} canvasRef={sparkRefs.fps} />
        <MetricItem label="Latency" value={m ? `${m.latency}ms` : "—"} canvasRef={sparkRefs.latency} />
        <MetricItem label="SLAM Accuracy" value={m ? `${m.slamAccuracy}%` : "—"} canvasRef={sparkRefs.slam} />

        <div>
          <div className="metric-label">Healing Status</div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className={`w-2.5 h-2.5 rounded-full ${healingEnabled && isRunning ? "bg-healing-active animate-pulse-glow" : "bg-muted-foreground"}`} />
            <span className="metric-value text-lg">{healingEnabled && isRunning ? "ACTIVE" : "INACTIVE"}</span>
          </div>
        </div>

        <MetricItem label="Avg Confidence" value={m ? `${m.avgConfidence}%` : "—"} canvasRef={sparkRefs.confidence} />

        {m && (
          <div>
            <div className="metric-label">Healing Ratio</div>
            <div className="metric-value text-lg">{m.healingRatio}%</div>
            <div className="w-full bg-muted rounded-full h-1.5 mt-1">
              <div className="bg-healing-active h-1.5 rounded-full transition-all" style={{ width: `${m.healingRatio}%` }} />
            </div>
          </div>
        )}

        {m && (
          <div>
            <div className="metric-label">Ego Motion</div>
            <div className="text-xs text-muted-foreground font-mono mt-1 space-y-0.5">
              <div>Forward: {m.egoMotion.forward.toFixed(4)}</div>
              <div>Yaw: {m.egoMotion.yaw.toFixed(4)}</div>
              <div>Lateral: {m.egoMotion.lateral.toFixed(4)}</div>
              <div>Quality: {(m.egoMotion.quality * 100).toFixed(0)}%</div>
            </div>
          </div>
        )}

        {/* Object counts */}
        <div className="border-t border-border pt-2 mt-1">
          <div className="metric-label mb-2">Detected Objects</div>
          <div className="grid grid-cols-2 gap-2">
            {m && (Object.entries(m.counts) as [ObjectLabel, number][]).map(([label, count]) => (
              <div key={label} className="flex items-center gap-1.5 bg-muted/30 rounded px-2 py-1">
                <span className="text-sm">{LABEL_ICONS[label]}</span>
                <span className="text-xs capitalize text-foreground">{label}</span>
                <span className="ml-auto text-xs font-mono text-primary">{count}</span>
              </div>
            ))}
          </div>
          {m && (
            <div className="mt-2 text-xs text-muted-foreground font-mono">
              Total: {frameData.objects.length} objects
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function MetricItem({ label, value, canvasRef }: { label: string; value: string; canvasRef: React.RefObject<HTMLCanvasElement> }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className="metric-value text-lg">{value}</div>
      <canvas ref={canvasRef} width={200} height={24} className="sparkline-container mt-0.5" />
    </div>
  );
}

function drawSparkline(canvas: HTMLCanvasElement | null, data: number[], min: number, max: number) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "hsl(200, 80%, 55%)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((data[i] - min) / (max - min)) * h * 0.8 - h * 0.1;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export default MetricsPanel;
