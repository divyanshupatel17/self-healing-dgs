# Self-Healing Monocular Digital Twins via Dynamic 3D Gaussian Splatting for Autonomous Edge Vehicles

![Project preview](./preview.png)

## VELLORE INSTITUTE OF TECHNOLOGY
**Chennai Campus**  
**School of Computer Science and Engineering (SCOPE)**

## PROJECT REPORT
**Self-Healing Monocular Digital Twins via Dynamic 3D Gaussian Splatting for Autonomous Edge Vehicles**

**Submitted by:**  
Shivam Goel (23BAI1534)  
Divyanshu Patel (23BAI1214)  
Ayush Upadhyay (23BAI1231)

**Under the guidance of:**  
Dr. Rajiv Vincent

**April 2026**

---

## Overview
This repository contains an end-to-end system for building a **self-healing monocular digital twin pipeline** for autonomous edge vehicles.  
The platform ingests dashcam video, simulates adverse visual conditions, restores degraded regions, performs object detection, estimates approximate 3D positions, and visualizes the reconstructed scene in a live dashboard.

## Key Objectives
- Process monocular dashcam streams in near real time
- Simulate difficult visual conditions such as fog, blur, and partial occlusion
- Restore impacted frame regions with a self-healing image pipeline
- Detect road participants (car, person, bike, truck)
- Map 2D detections into approximate 3D space
- Reconstruct and render scene context using Gaussian-splatting-inspired representation

## System Pipeline
`Video Input -> Occlusion Simulation -> Self-Healing -> Object Detection -> 2D to 3D Mapping -> Gaussian Scene Reconstruction -> Live Dashboard`

## Architecture Modules
### 1. Input & Streaming Module
- Dashcam/video ingestion
- Frame extraction and sequential processing
- Monocular camera workflow

### 2. Degradation Simulation Module
- Fog simulation
- Blur injection
- Partial obstruction masks

### 3. Self-Healing Module
- Region-selective enhancement
- CLAHE-based contrast recovery
- Sharpening and restoration operations

### 4. Detection Module
- YOLO-based detection pipeline
- Road-object class filtering
- Confidence-driven detection outputs

### 5. Spatial Mapping Module
- 2D bounding box to approximate 3D point conversion
- Scale/position heuristics for monocular depth approximation
- Scene-coordinate projection for rendering

### 6. Visualization Module
- Interactive web dashboard
- Live object overlays and telemetry cues
- 3D scene reconstruction preview

## Tech Stack
| Layer | Technologies |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | FastAPI, WebSocket, Python |
| Vision | OpenCV, Ultralytics YOLO |
| 3D/Rendering | Three.js / React Three Fiber |
| Testing | Vitest, Playwright |

## Repository Structure
```text
dl-main/
|- backend/                # FastAPI backend and vision pipeline
|- src/                    # React frontend source
|- docs/                   # Project report artifacts
|- public/                 # Static assets
|- run-dev.ps1             # Windows convenience script to run app
|- preview.png             # Dashboard/project preview image
|- yolov8n.pt              # YOLO model weights
```

## Setup and Run
### Prerequisites
- Node.js 18+
- Python 3.10+

### 1. Install frontend dependencies
```powershell
npm install
```

### 2. Set up Python environment
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r .\backend\requirements.txt
```

### 3. Start the application
**Recommended (Windows):**
```powershell
.\run-dev.ps1
```

**Manual (two terminals):**
```powershell
# Terminal 1 (backend)
npm run dev:backend

# Terminal 2 (frontend)
npm run dev
```

### 4. Access endpoints
- Frontend: `http://localhost:8080`
- Backend health: `http://localhost:8000/health`

## Notes
- `preview.png` is included as the primary visual preview for this repository.
- Extended documentation/report files are available in `docs/`.
