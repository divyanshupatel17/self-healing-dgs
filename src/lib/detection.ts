export type ObjectLabel = "car" | "truck" | "bus" | "person" | "bike" | "motorcycle";
export type ObjectState = "normal" | "occluded" | "healed";

export interface DetectedObject {
  id: string;
  label: ObjectLabel;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  state: ObjectState;
  depth: number;
  color: string;
  size3d: { x: number; y: number; z: number };
  pos3d: { x: number; y: number; z: number };
}

export interface PipelineDetection {
  id: string;
  label: ObjectLabel;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  state: ObjectState;
  depth?: number;
  dimensions?: { x: number; y: number; z: number };
}

export interface PipelineFrameMessage {
  type: "frame_result";
  frame_id: number;
  raw_frame: string;
  occluded_frame: string;
  healed_frame: string;
  detections: PipelineDetection[];
  metrics: {
    fps: number;
    latency: number;
    slamAccuracy: number;
    avgConfidence: number;
    healingRatio: number;
    counts: Partial<Record<ObjectLabel, number>>;
    egoMotion?: {
      forward: number;
      yaw: number;
      lateral: number;
      quality: number;
    };
  };
}

export interface FrameData {
  objects: DetectedObject[];
  metrics: {
    fps: number;
    latency: number;
    slamAccuracy: number;
    avgConfidence: number;
    healingRatio: number;
    counts: Record<ObjectLabel, number>;
    egoMotion: {
      forward: number;
      yaw: number;
      lateral: number;
      quality: number;
    };
  };
}

const LABEL_COLORS: Record<ObjectLabel, string> = {
  car: "#ffffff",
  truck: "#f97316",
  bus: "#f59e0b",
  person: "#facc15",
  bike: "#06b6d4",
  motorcycle: "#14b8a6",
};

const OBJECT_3D_SIZE: Record<ObjectLabel, [number, number, number]> = {
  car: [2.0, 1.3, 1.1],
  truck: [2.8, 2.1, 1.6],
  bus: [3.0, 2.3, 1.7],
  person: [0.6, 1.8, 0.5],
  bike: [1.0, 1.1, 1.5],
  motorcycle: [1.2, 1.2, 1.7],
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function detectionToObject(d: PipelineDetection): DetectedObject {
  const cx = d.bbox.x + d.bbox.w * 0.5;
  const cy = d.bbox.y + d.bbox.h * 0.5;
  const area = clamp01(d.bbox.w * d.bbox.h);
  const fallbackDepth = clamp01(1 - area * 4.0);
  const depth = clamp01(typeof d.depth === "number" ? d.depth : fallbackDepth);

  const classSize = OBJECT_3D_SIZE[d.label];
  const size3d = {
    x: Math.max(0.3, d.dimensions?.x ?? classSize[0]),
    y: Math.max(0.3, d.dimensions?.y ?? classSize[1]),
    z: Math.max(0.3, d.dimensions?.z ?? classSize[2]),
  };

  return {
    id: d.id,
    label: d.label,
    bbox: {
      x: clamp01(d.bbox.x),
      y: clamp01(d.bbox.y),
      w: clamp01(d.bbox.w),
      h: clamp01(d.bbox.h),
    },
    confidence: Math.round(d.confidence),
    state: d.state,
    depth,
    color: LABEL_COLORS[d.label],
    size3d,
    pos3d: {
      x: (cx - 0.5) * 24,
      y: 0.6 + (1 - cy) * 2.1,
      z: -5 - depth * 20,
    },
  };
}

export function buildFrameDataFromPipeline(message: PipelineFrameMessage): FrameData {
  const objects = message.detections.map(detectionToObject);
  const counts: Record<ObjectLabel, number> = {
    car: 0,
    truck: 0,
    bus: 0,
    person: 0,
    bike: 0,
    motorcycle: 0,
  };

  for (const label of Object.keys(counts) as ObjectLabel[]) {
    counts[label] = message.metrics.counts[label] ?? 0;
  }

  return {
    objects,
    metrics: {
      fps: Math.round(message.metrics.fps),
      latency: Math.round(message.metrics.latency),
      slamAccuracy: Number(message.metrics.slamAccuracy.toFixed(1)),
      avgConfidence: Math.round(message.metrics.avgConfidence),
      healingRatio: Math.round(message.metrics.healingRatio),
      counts,
      egoMotion: {
        forward: message.metrics.egoMotion?.forward ?? 0,
        yaw: message.metrics.egoMotion?.yaw ?? 0,
        lateral: message.metrics.egoMotion?.lateral ?? 0,
        quality: message.metrics.egoMotion?.quality ?? 0,
      },
    },
  };
}
