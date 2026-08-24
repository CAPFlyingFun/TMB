import { ViewerState } from '@/lib/three-scene';
import { Switch } from '@/components/ui/switch';
import { Layers, Activity } from 'lucide-react';

interface ControlsPanelProps {
  state: ViewerState;
  onUpdateLayer: (key: keyof ViewerState['layers'], value: boolean) => void;
  onUpdateDiagnostic: (key: keyof ViewerState['diagnostics'], value: boolean) => void;
}

export function ControlsPanel({ state, onUpdateLayer, onUpdateDiagnostic }: ControlsPanelProps) {
  return (
    <div className="flex flex-col md:flex-row gap-4 pointer-events-auto">
      <div className="bg-card/80 backdrop-blur-md border border-border p-4 rounded-lg shadow-xl w-full md:w-64 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Layers className="w-4 h-4 text-primary" />
          ENVIRONMENT LAYERS
        </div>
        <div className="flex flex-col gap-3">
          <ToggleRow label="Terrain Mesh" checked={state.layers.terrain} onChange={(v) => onUpdateLayer('terrain', v)} />
          <ToggleRow label="Rivers & Streams" checked={state.layers.rivers} onChange={(v) => onUpdateLayer('rivers', v)} />
          <ToggleRow label="Standing Water" checked={state.layers.standingWater} onChange={(v) => onUpdateLayer('standingWater', v)} />
          <ToggleRow label="Ocean Base" checked={state.layers.ocean} onChange={(v) => onUpdateLayer('ocean', v)} />
        </div>
      </div>

      <div className="bg-card/80 backdrop-blur-md border border-border p-4 rounded-lg shadow-xl w-full md:w-64 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Activity className="w-4 h-4 text-primary" />
          DIAGNOSTICS
        </div>
        <div className="flex flex-col gap-3">
          <ToggleRow label="Tile Boundaries" checked={state.diagnostics.tileBoundaries} onChange={(v) => onUpdateDiagnostic('tileBoundaries', v)} />
          <ToggleRow label="Water Ownership" checked={state.diagnostics.waterOwnership} onChange={(v) => onUpdateDiagnostic('waterOwnership', v)} />
          <ToggleRow label="Spill Levels" checked={state.diagnostics.spillLevels} onChange={(v) => onUpdateDiagnostic('spillLevels', v)} />
          <ToggleRow label="Wireframe" checked={state.diagnostics.wireframe} onChange={(v) => onUpdateDiagnostic('wireframe', v)} />
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
