interface ControlsPanelProps {
  isRunning: boolean;
  healingEnabled: boolean;
  detectionLevel: number;
  onStart: () => void;
  onStop: () => void;
  onToggleHealing: () => void;
  onDetectionLevelChange: (v: number) => void;
}

const ControlsPanel = ({
  isRunning,
  healingEnabled,
  detectionLevel,
  onStart,
  onStop,
  onToggleHealing,
  onDetectionLevelChange,
}: ControlsPanelProps) => {
  return (
    <div className="panel-glass">
      <div className="panel-header">Controls</div>
      <div className="flex items-center gap-6 p-4 flex-wrap">
        <button
          onClick={onStart}
          disabled={isRunning}
          className="px-6 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          Start System
        </button>
        <button
          onClick={onStop}
          disabled={!isRunning}
          className="px-6 py-2 rounded-md bg-secondary text-secondary-foreground font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity border border-border"
        >
          Stop System
        </button>

        <div className="flex items-center gap-3">
          <span className="text-sm text-foreground">Enable Healing</span>
          <button
            onClick={onToggleHealing}
            className={`relative w-12 h-6 rounded-full transition-colors ${healingEnabled ? "bg-primary" : "bg-muted"}`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-foreground transition-transform ${healingEnabled ? "left-6" : "left-0.5"}`}
            />
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-primary-foreground">
              {healingEnabled ? "ON" : "OFF"}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <span className="text-sm text-foreground">Detection Level</span>
          <input
            type="range"
            min={0}
            max={100}
            value={detectionLevel}
            onChange={(e) => onDetectionLevelChange(Number(e.target.value))}
            className="w-32 accent-primary"
          />
        </div>
      </div>
    </div>
  );
};

export default ControlsPanel;
