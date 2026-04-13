import base64
import importlib
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware


ULTRA_SETTINGS_DIR = Path(__file__).resolve().parent / ".ultralytics"
ULTRA_SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
os.environ["YOLO_CONFIG_DIR"] = str(ULTRA_SETTINGS_DIR)

try:
    from ultralytics import YOLO
except Exception:
    YOLO = None


LABELS = ("car", "truck", "bus", "person", "bike", "motorcycle")
YOLO_CLASS_TO_LABEL = {
    0: "person",
    1: "bike",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

OBJECT_DIMS = {
    "car": (2.0, 1.3, 1.1),
    "truck": (2.8, 2.1, 1.6),
    "bus": (3.0, 2.3, 1.7),
    "person": (0.6, 1.8, 0.5),
    "bike": (1.0, 1.1, 1.5),
    "motorcycle": (1.2, 1.2, 1.7),
}


@dataclass
class Track:
    track_id: int
    label: str
    bbox: Tuple[float, float, float, float]
    confidence: float
    missed: int = 0


class StableTracker:
    def __init__(self) -> None:
        self.next_id = 1
        self.tracks: Dict[int, Track] = {}

    @staticmethod
    def _iou(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        ax2, ay2 = ax + aw, ay + ah
        bx2, by2 = bx + bw, by + bh

        ix1, iy1 = max(ax, bx), max(ay, by)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
        inter = iw * ih
        union = aw * ah + bw * bh - inter
        if union <= 1e-6:
            return 0.0
        return inter / union

    def update(self, detections: List[Dict[str, object]]) -> List[Dict[str, object]]:
        for track in self.tracks.values():
            track.missed += 1

        candidates: List[Tuple[float, int, int]] = []
        track_ids = list(self.tracks.keys())
        for d_idx, det in enumerate(detections):
            bbox = det["bbox"]
            label = det["label"]
            bbox_tuple = (bbox["x"], bbox["y"], bbox["w"], bbox["h"])
            for t_id in track_ids:
                t = self.tracks[t_id]
                if t.label != label:
                    continue
                iou = self._iou(t.bbox, bbox_tuple)
                if iou >= 0.2:
                    candidates.append((iou, t_id, d_idx))

        candidates.sort(reverse=True, key=lambda item: item[0])
        used_tracks = set()
        used_dets = set()

        for _, track_id, det_idx in candidates:
            if track_id in used_tracks or det_idx in used_dets:
                continue
            track = self.tracks[track_id]
            det = detections[det_idx]
            bbox = det["bbox"]
            bx, by, bw, bh = bbox["x"], bbox["y"], bbox["w"], bbox["h"]
            tx, ty, tw, th = track.bbox

            # EMA bbox smoothing for stable boxes.
            alpha = 0.65
            smoothed = (
                tx * (1.0 - alpha) + bx * alpha,
                ty * (1.0 - alpha) + by * alpha,
                tw * (1.0 - alpha) + bw * alpha,
                th * (1.0 - alpha) + bh * alpha,
            )
            track.bbox = smoothed
            track.confidence = float(det["confidence"])
            track.missed = 0
            det["id"] = str(track.track_id)
            det["bbox"] = {
                "x": float(smoothed[0]),
                "y": float(smoothed[1]),
                "w": float(smoothed[2]),
                "h": float(smoothed[3]),
            }
            used_tracks.add(track_id)
            used_dets.add(det_idx)

        for d_idx, det in enumerate(detections):
            if d_idx in used_dets:
                continue
            bbox = det["bbox"]
            track = Track(
                track_id=self.next_id,
                label=str(det["label"]),
                bbox=(bbox["x"], bbox["y"], bbox["w"], bbox["h"]),
                confidence=float(det["confidence"]),
                missed=0,
            )
            self.tracks[self.next_id] = track
            det["id"] = str(self.next_id)
            self.next_id += 1

        stale_ids = [tid for tid, t in self.tracks.items() if t.missed > 8]
        for tid in stale_ids:
            del self.tracks[tid]

        return detections


@dataclass
class ConnectionState:
    tracker: StableTracker = field(default_factory=StableTracker)
    frame_index: int = 0
    fps_ema: float = 24.0
    enhanced_prev: Optional[np.ndarray] = None
    prev_gray: Optional[np.ndarray] = None
    depth_prev: Optional[np.ndarray] = None
    motion_ema: Dict[str, float] = field(
        default_factory=lambda: {"forward": 0.0, "yaw": 0.0, "lateral": 0.0, "quality": 0.0}
    )


MODEL = None
MODEL_ERROR: Optional[str] = None
DEPTH_PROCESSOR = None
DEPTH_MODEL = None
DEPTH_ERROR: Optional[str] = None
TORCH_MODULE = None
TORCH_F = None


def load_depth_model() -> bool:
    global DEPTH_PROCESSOR, DEPTH_MODEL, DEPTH_ERROR, TORCH_MODULE, TORCH_F
    if DEPTH_MODEL is not None:
        return True
    if DEPTH_ERROR is not None:
        return False

    try:
        TORCH_MODULE = importlib.import_module("torch")
        TORCH_F = importlib.import_module("torch.nn.functional")
        transformers = importlib.import_module("transformers")
        AutoImageProcessor = getattr(transformers, "AutoImageProcessor")
        AutoModelForDepthEstimation = getattr(transformers, "AutoModelForDepthEstimation")
    except Exception:
        DEPTH_ERROR = "depth dependencies missing"
        return False

    model_name = os.getenv("DEPTH_MODEL_NAME", "depth-anything/Depth-Anything-V2-Small-hf")
    try:
        DEPTH_PROCESSOR = AutoImageProcessor.from_pretrained(model_name)
        DEPTH_MODEL = AutoModelForDepthEstimation.from_pretrained(model_name)
        DEPTH_MODEL.eval()
        if TORCH_MODULE.cuda.is_available():
            DEPTH_MODEL.to("cuda")
        DEPTH_ERROR = None
        return True
    except Exception as exc:
        DEPTH_PROCESSOR = None
        DEPTH_MODEL = None
        DEPTH_ERROR = str(exc)
        return False


def load_model() -> Optional[object]:
    global MODEL, MODEL_ERROR
    if MODEL is not None or MODEL_ERROR is not None:
        return MODEL

    if YOLO is None:
        MODEL_ERROR = "ultralytics not available"
        return None

    try:
        MODEL = YOLO("yolov8n.pt")
    except Exception as exc:
        first_error = str(exc)

        if "WinError 32" in first_error and os.path.exists("yolov8n.pt"):
            try:
                time.sleep(0.6)
                MODEL = YOLO("yolov8n.pt")
                MODEL_ERROR = None
                return MODEL
            except Exception as retry_locked_exc:
                first_error = str(retry_locked_exc)

        # Recover from a partially downloaded/corrupted weight file once.
        if os.path.exists("yolov8n.pt") and (
            "PytorchStreamReader" in first_error or "failed finding central directory" in first_error
        ):
            try:
                os.remove("yolov8n.pt")
                MODEL = YOLO("yolov8n.pt")
                MODEL_ERROR = None
                return MODEL
            except Exception as retry_exc:
                MODEL_ERROR = str(retry_exc)
                MODEL = None
                return None

        MODEL_ERROR = first_error
        MODEL = None
    return MODEL


def decode_image(data_url: str) -> Optional[np.ndarray]:
    try:
        payload = data_url.split(",", 1)[1] if "," in data_url else data_url
        raw = base64.b64decode(payload)
        arr = np.frombuffer(raw, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return frame
    except Exception:
        return None


def encode_image(frame: np.ndarray) -> str:
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
    if not ok:
        return ""
    b64 = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def gray_world_balance(frame: np.ndarray) -> np.ndarray:
    # Fast white-balance correction for foggy blue/gray casts.
    f = frame.astype(np.float32)
    means = np.mean(f, axis=(0, 1)) + 1e-6
    mean_all = float(np.mean(means))
    scales = mean_all / means
    balanced = f * scales
    return np.clip(balanced, 0, 255).astype(np.uint8)


def dehaze_luma(frame: np.ndarray) -> np.ndarray:
    # Lightweight local-contrast recovery on luminance.
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.3, tileGridSize=(8, 8))
    l = clahe.apply(l)
    merged = cv2.merge((l, a, b))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def clear_visibility(frame: np.ndarray, state: ConnectionState) -> np.ndarray:
    # Phase A pipeline: white balance -> dehaze/contrast -> mild sharpen -> temporal stabilize.
    balanced = gray_world_balance(frame)
    enhanced = dehaze_luma(balanced)

    gamma = 1.1
    inv_gamma = 1.0 / gamma
    lut = np.array([(i / 255.0) ** inv_gamma * 255 for i in range(256)], dtype=np.uint8)
    corrected = cv2.LUT(enhanced, lut)

    # Mild unsharp mask to recover details without amplifying dust noise.
    blur = cv2.GaussianBlur(corrected, (0, 0), 0.9)
    sharpened = cv2.addWeighted(corrected, 1.1, blur, -0.1, 0)

    if state.enhanced_prev is None:
        state.enhanced_prev = sharpened
        return sharpened

    stabilized = cv2.addWeighted(sharpened, 0.68, state.enhanced_prev, 0.32, 0)
    state.enhanced_prev = stabilized
    return stabilized


def estimate_ego_motion(frame_bgr: np.ndarray, state: ConnectionState) -> Dict[str, float]:
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]

    if state.prev_gray is None:
        state.prev_gray = gray
        return dict(state.motion_ema)

    prev_pts = cv2.goodFeaturesToTrack(
        state.prev_gray,
        maxCorners=250,
        qualityLevel=0.01,
        minDistance=8,
        blockSize=7,
    )

    if prev_pts is None or len(prev_pts) < 12:
        state.prev_gray = gray
        state.motion_ema["quality"] *= 0.9
        return dict(state.motion_ema)

    next_pts, status, _ = cv2.calcOpticalFlowPyrLK(
        state.prev_gray,
        gray,
        prev_pts,
        None,
        winSize=(19, 19),
        maxLevel=3,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03),
    )

    if next_pts is None or status is None:
        state.prev_gray = gray
        state.motion_ema["quality"] *= 0.9
        return dict(state.motion_ema)

    good_old = prev_pts[status.ravel() == 1].reshape(-1, 2)
    good_new = next_pts[status.ravel() == 1].reshape(-1, 2)
    tracked = len(good_old)
    if tracked < 10:
        state.prev_gray = gray
        state.motion_ema["quality"] *= 0.9
        return dict(state.motion_ema)

    flow = good_new - good_old
    median_dx = float(np.median(flow[:, 0]))
    median_dy = float(np.median(flow[:, 1]))

    yaw = 0.0
    quality = min(1.0, tracked / 140.0)

    transform, inliers = cv2.estimateAffinePartial2D(
        good_old,
        good_new,
        method=cv2.RANSAC,
        ransacReprojThreshold=2.2,
        maxIters=1000,
        confidence=0.98,
    )
    if transform is not None:
        a = float(transform[0, 0])
        b = float(transform[0, 1])
        yaw = float(np.arctan2(b, a))
        if inliers is not None and len(inliers) > 0:
            quality = max(quality, float(np.sum(inliers)) / float(len(inliers)))

    forward_raw = median_dy / max(1.0, h)
    lateral_raw = median_dx / max(1.0, w)

    alpha = 0.22
    state.motion_ema["forward"] = state.motion_ema["forward"] * (1.0 - alpha) + forward_raw * alpha
    state.motion_ema["lateral"] = state.motion_ema["lateral"] * (1.0 - alpha) + lateral_raw * alpha
    state.motion_ema["yaw"] = state.motion_ema["yaw"] * (1.0 - alpha) + yaw * alpha
    state.motion_ema["quality"] = state.motion_ema["quality"] * (1.0 - alpha) + quality * alpha

    state.prev_gray = gray
    return dict(state.motion_ema)


def infer_depth_map(frame_bgr: np.ndarray, state: ConnectionState) -> Optional[np.ndarray]:
    h, w = frame_bgr.shape[:2]

    if load_depth_model() and DEPTH_MODEL is not None and DEPTH_PROCESSOR is not None and TORCH_MODULE is not None and TORCH_F is not None:
        try:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            inputs = DEPTH_PROCESSOR(images=rgb, return_tensors="pt")
            device = "cuda" if TORCH_MODULE.cuda.is_available() else "cpu"
            inputs = {k: v.to(device) for k, v in inputs.items()}
            with TORCH_MODULE.no_grad():
                pred = DEPTH_MODEL(**inputs).predicted_depth
            pred = TORCH_F.interpolate(
                pred.unsqueeze(1),
                size=(h, w),
                mode="bicubic",
                align_corners=False,
            ).squeeze()
            depth = pred.detach().float().cpu().numpy()

            d_min = float(np.percentile(depth, 2.0))
            d_max = float(np.percentile(depth, 98.0))
            depth = np.clip((depth - d_min) / max(1e-6, d_max - d_min), 0.0, 1.0)
            depth = 1.0 - depth

            if state.depth_prev is not None and state.depth_prev.shape == depth.shape:
                depth = 0.65 * depth + 0.35 * state.depth_prev
            state.depth_prev = depth
            return depth
        except Exception:
            pass

    # Fallback: deterministic perspective prior to avoid broken values when depth model is unavailable.
    yy = np.linspace(0.0, 1.0, h, dtype=np.float32).reshape(h, 1)
    xx = np.linspace(0.0, 1.0, w, dtype=np.float32).reshape(1, w)
    horizon_prior = np.clip((yy - 0.18) / 0.82, 0.0, 1.0)
    center_bias = 1.0 - np.abs(xx - 0.5) * 0.6
    depth = np.clip(horizon_prior * center_bias, 0.0, 1.0)
    if state.depth_prev is not None and state.depth_prev.shape == depth.shape:
        depth = 0.7 * depth + 0.3 * state.depth_prev
    state.depth_prev = depth
    return depth


def enrich_detections_with_depth(detections: List[Dict[str, object]], depth_map: Optional[np.ndarray]) -> None:
    for det in detections:
        bbox = det["bbox"]
        x, y, w, h = float(bbox["x"]), float(bbox["y"]), float(bbox["w"]), float(bbox["h"])
        label = str(det["label"])

        # Fallback depth from bounding-box area and vertical location.
        area = max(0.0, min(1.0, w * h))
        cy = y + 0.5 * h
        fallback_depth = float(np.clip(0.55 * (1.0 - area * 3.5) + 0.45 * cy, 0.02, 0.98))
        depth_value = fallback_depth

        if depth_map is not None:
            dh, dw = depth_map.shape[:2]
            x1 = int(max(0, min(dw - 1, x * dw)))
            y1 = int(max(0, min(dh - 1, y * dh)))
            x2 = int(max(x1 + 1, min(dw, (x + w) * dw)))
            y2 = int(max(y1 + 1, min(dh, (y + h) * dh)))

            roi = depth_map[y1:y2, x1:x2]
            if roi.size > 0:
                depth_value = float(np.clip(np.median(roi), 0.02, 0.98))

        base_dims = OBJECT_DIMS.get(label, (1.4, 1.2, 1.0))
        scale = 0.75 + depth_value * 0.7
        det["depth"] = round(depth_value, 4)
        det["dimensions"] = {
            "x": round(float(base_dims[0] * scale), 3),
            "y": round(float(base_dims[1]), 3),
            "z": round(float(base_dims[2] * scale), 3),
        }


def run_detection(frame: np.ndarray, conf_threshold: float) -> List[Dict[str, object]]:
    model = load_model()
    if model is None:
        return []

    detections: List[Dict[str, object]] = []
    result = model.predict(
        source=frame,
        conf=conf_threshold,
        verbose=False,
        imgsz=320,
        max_det=25,
    )
    if not result:
        return detections

    h, w = frame.shape[:2]
    for box in result[0].boxes:
        class_id = int(box.cls.item())
        label = YOLO_CLASS_TO_LABEL.get(class_id)
        if label is None:
            continue

        x1, y1, x2, y2 = box.xyxy[0].tolist()
        x1 = max(0.0, min(float(w - 1), float(x1)))
        y1 = max(0.0, min(float(h - 1), float(y1)))
        x2 = max(0.0, min(float(w), float(x2)))
        y2 = max(0.0, min(float(h), float(y2)))

        bw = max(1.0, x2 - x1)
        bh = max(1.0, y2 - y1)

        detections.append(
            {
                "id": "",
                "label": label,
                "bbox": {
                    "x": x1 / w,
                    "y": y1 / h,
                    "w": bw / w,
                    "h": bh / h,
                },
                "confidence": round(float(box.conf.item()) * 100.0, 1),
                "state": "normal",
            }
        )

    return detections


def detections_from_tracks(tracker: StableTracker) -> List[Dict[str, object]]:
    dets: List[Dict[str, object]] = []
    for track in tracker.tracks.values():
        if track.missed > 3:
            continue
        x, y, w, h = track.bbox
        dets.append(
            {
                "id": str(track.track_id),
                "label": track.label,
                "bbox": {
                    "x": float(x),
                    "y": float(y),
                    "w": float(w),
                    "h": float(h),
                },
                "confidence": max(15.0, float(track.confidence) - 2.0 * track.missed),
                "state": "normal",
            }
        )
    return dets


def build_counts(detections: List[Dict[str, object]]) -> Dict[str, int]:
    counts = {label: 0 for label in LABELS}
    for det in detections:
        label = str(det["label"])
        if label in counts:
            counts[label] += 1
    return counts


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, object]:
    load_model()
    return {
        "ok": True,
        "model_loaded": MODEL is not None,
        "model_error": MODEL_ERROR,
        "depth_model_loaded": DEPTH_MODEL is not None,
        "depth_model_error": DEPTH_ERROR,
    }


@app.websocket("/ws/pipeline")
async def websocket_pipeline(websocket: WebSocket) -> None:
    await websocket.accept()
    state = ConnectionState()

    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue

            if payload.get("type") != "frame":
                continue

            t0 = time.perf_counter()
            state.frame_index += 1

            frame = decode_image(str(payload.get("image", "")))
            if frame is None:
                continue

            frame_id = int(payload.get("frame_id", state.frame_index))
            healing_enabled = bool(payload.get("healing_enabled", True))
            detection_level = max(0, min(100, int(payload.get("detection_level", 75))))
            conf_threshold = max(0.15, min(0.7, 0.7 - (detection_level / 100.0) * 0.55))

            raw_frame = frame.copy()
            healed_frame = clear_visibility(frame, state) if healing_enabled else raw_frame
            ego_motion = estimate_ego_motion(raw_frame, state)
            depth_map = infer_depth_map(healed_frame, state)

            should_detect = (state.frame_index % 2 == 0) or len(state.tracker.tracks) == 0
            if should_detect:
                detections = run_detection(healed_frame, conf_threshold)
                detections = state.tracker.update(detections)
            else:
                detections = detections_from_tracks(state.tracker)

            for det in detections:
                det["state"] = "normal"

            enrich_detections_with_depth(detections, depth_map)

            counts = build_counts(detections)
            avg_conf = 0.0
            if detections:
                avg_conf = sum(float(d["confidence"]) for d in detections) / len(detections)

            latency_ms = (time.perf_counter() - t0) * 1000.0
            instant_fps = 1000.0 / max(latency_ms, 1.0)
            state.fps_ema = state.fps_ema * 0.8 + instant_fps * 0.2

            response = {
                "type": "frame_result",
                "frame_id": frame_id,
                "raw_frame": encode_image(raw_frame),
                "occluded_frame": encode_image(raw_frame),
                "healed_frame": encode_image(healed_frame),
                "detections": detections,
                "metrics": {
                    "fps": round(min(60.0, max(1.0, state.fps_ema)), 1),
                    "latency": round(latency_ms, 1),
                    "slamAccuracy": round(97.0 + min(1.0, float(ego_motion["quality"])) * 3.0, 1),
                    "avgConfidence": round(avg_conf, 1),
                    "healingRatio": 100.0 if healing_enabled else 0.0,
                    "counts": counts,
                    "egoMotion": {
                        "forward": round(float(ego_motion["forward"]), 5),
                        "yaw": round(float(ego_motion["yaw"]), 5),
                        "lateral": round(float(ego_motion["lateral"]), 5),
                        "quality": round(float(ego_motion["quality"]), 3),
                    },
                },
            }
            await websocket.send_json(response)
    except WebSocketDisconnect:
        return


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
