import { useState, useCallback } from "react";
import HeaderBar from "@/components/dashboard/HeaderBar";
import CameraPanel from "@/components/dashboard/CameraPanel";
import GaussianScene from "@/components/dashboard/GaussianScene";
import MetricsPanel from "@/components/dashboard/MetricsPanel";
import ControlsPanel from "@/components/dashboard/ControlsPanel";
import {
  buildFrameDataFromPipeline,
  type FrameData,
  type PipelineFrameMessage,
} from "@/lib/detection";

const Index = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [healingEnabled, setHealingEnabled] = useState(true);
  const [detectionLevel, setDetectionLevel] = useState(75);
  const [frameData, setFrameData] = useState<FrameData | null>(null);

  const handleFrameMessage = useCallback((message: PipelineFrameMessage) => {
    setFrameData(buildFrameDataFromPipeline(message));
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <HeaderBar />
      <div className="flex-1 grid grid-cols-[1fr_2fr_280px] gap-2 p-2 min-h-0">
        <CameraPanel
          isRunning={isRunning}
          healingEnabled={healingEnabled}
          detectionLevel={detectionLevel}
          detectedObjects={frameData?.objects ?? []}
          onFrameMessage={handleFrameMessage}
        />
        <div className="flex flex-col gap-2 min-h-0">
          <div className="flex-1 min-h-0">
            <GaussianScene isRunning={isRunning} frameData={frameData} />
          </div>
          <ControlsPanel
            isRunning={isRunning}
            healingEnabled={healingEnabled}
            detectionLevel={detectionLevel}
            onStart={() => setIsRunning(true)}
            onStop={() => setIsRunning(false)}
            onToggleHealing={() => setHealingEnabled((v) => !v)}
            onDetectionLevelChange={setDetectionLevel}
          />
        </div>
        <MetricsPanel
          isRunning={isRunning}
          healingEnabled={healingEnabled}
          detectionLevel={detectionLevel}
          frameData={frameData}
        />
      </div>
    </div>
  );
};

export default Index;
