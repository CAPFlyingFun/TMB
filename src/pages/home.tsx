import { useEffect, useRef, useState, useCallback } from 'react';
import {
  type ViewerState,
  type TelemetryData,
  type SceneStatus,
} from '@/lib/three-scene';
import type { TerrainScene } from '@/lib/three-scene';
import { TelemetryOverlay } from '@/components/viewer/telemetry-overlay';
import { ControlsPanel } from '@/components/viewer/controls-panel';
import { LocationsPanel } from '@/components/viewer/locations-panel';
import { Compass, Crosshair, Layers, MapPin, X } from 'lucide-react';

const INITIAL_STATE: ViewerState = {
  layers: {
    terrain: true,
    rivers: true,
    standingWater: true,
    ocean: true,
  },
  diagnostics: {
    tileBoundaries: false,
    waterOwnership: false,
    spillLevels: false,
    wireframe: false,
  }
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<TerrainScene | null>(null);
  
  const [viewerState, setViewerState] = useState<ViewerState>(INITIAL_STATE);
  /**
   * WHICH PANEL A PHONE IS SHOWING, or none.
   *
   * On a desktop all three panels can sit in the corners and still
   * leave the island in the middle. On a 390 px screen they stack and
   * cover roughly three quarters of it, which is the whole complaint:
   * you cannot inspect terrain you cannot see. Below `md` they collapse
   * to two buttons and open one at a time; at `md` and up nothing about
   * the existing layout changes.
   */
  const [sheet, setSheet] = useState<'layers' | 'places' | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    lat: 22.05,
    lon: -159.55,
    elevation: 31_000,
    groundElevation: 0,
    altitudeAboveGround: 31_000,
    heading: 0,
    pitch: -30,
  });
  const [status, setStatus] = useState<SceneStatus>({
    phase: 'loading',
    message: 'Loading NOAA terrain',
    loadedTiles: 0,
    activeTiles: 0,
    maximumActiveLevel: 0,
    riverFeatures: 0,
  });

  useEffect(() => {
    if (!canvasRef.current) return;
    let scene: TerrainScene | undefined;
    let cancelled = false;
    const startRenderer = async () => {
      try {
        const { TerrainScene: TerrainSceneRuntime } = await import(
          '@/lib/three-scene'
        );
        if (cancelled || !canvasRef.current) return;
        scene = new TerrainSceneRuntime(
          canvasRef.current,
          viewerState,
          setTelemetry,
          setStatus,
        );
        sceneRef.current = scene;
        // ANT-SCALE PROBE HANDLE. Disposable: it exists so a headless
        // run can stand the camera a stated number of metres above the
        // ground and look, which is the whole of this experiment.
        const live = scene;
        (window as unknown as Record<string, unknown>).__tmb = {
          standAt: (lat: number, lon: number, agl: number, heading = 0) =>
            live.standAt(lat, lon, agl, heading),
          jumpTo: (lat: number, lon: number, alt: number) => live.jumpTo(lat, lon, alt),
          placeQueen: (lat: number, lon: number, mm?: number) =>
            live.placeQueen(lat, lon, mm),
          watchQueen: (lat: number, lon: number, back: number, heading = 0) =>
            live.watchQueen(lat, lon, back, heading),
        };
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : 'This browser could not initialize the terrain renderer.';
        setStatus({
          phase: 'error',
          message,
          loadedTiles: 0,
          activeTiles: 0,
          maximumActiveLevel: 0,
          riverFeatures: 0,
        });
        console.error(error);
      }
    };
    void startRenderer();
    
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateState(viewerState);
    }
  }, [viewerState]);

  const handleJump = useCallback((lat: number, lon: number, elev: number) => {
    if (sceneRef.current) {
      sceneRef.current.jumpTo(lat, lon, elev);
    }
  }, []);

  const updateLayer = (key: keyof ViewerState['layers'], value: boolean) => {
    setViewerState(prev => ({
      ...prev,
      layers: { ...prev.layers, [key]: value }
    }));
  };

  const updateDiagnostic = (key: keyof ViewerState['diagnostics'], value: boolean) => {
    setViewerState(prev => ({
      ...prev,
      diagnostics: { ...prev.diagnostics, [key]: value }
    }));
  };

  return (
    // 100dvh, NOT 100vh. On iOS Safari `h-screen` counts the strip
    // behind the address bar and the toolbar, so the layout is taller
    // than what you can actually see and whatever sits at the bottom
    // falls off the edge — which is why the saved-vector list was cut
    // in half on a phone. The dynamic viewport unit is the visible box.
    <div className="relative w-full h-[100dvh] overflow-hidden bg-background text-foreground select-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-0" />

      {status.phase === 'error' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-[radial-gradient(circle_at_center,_hsl(160_20%_12%),_hsl(160_10%_5%)_60%)] px-6">
          <div className="max-w-md rounded-lg border border-red-400/30 bg-card/90 p-6 text-center shadow-2xl backdrop-blur-md">
            <p className="font-mono text-[10px] tracking-[0.24em] text-red-400">
              RENDERER UNAVAILABLE
            </p>
            <h2 className="mt-3 text-lg font-semibold text-foreground">
              WebGL could not start
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The terrain data is intact, but this browser or virtual machine
              does not expose a usable GPU context. Open the viewer in a
              WebGL-capable browser to inspect Kauaʻi.
            </p>
          </div>
        </div>
      )}
      
      {/* UI Overlay */}
      {/* SAFE AREA AT THE BOTTOM. The phone control bar sits where iOS
          draws the home indicator, and a 44 px target half-covered by a
          system gesture strip is a target you fight. `env()` is zero on
          everything that has no notch, so this costs desktop nothing. */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
        
        {/* Top Header & Telemetry */}
        <div className="flex justify-between items-start gap-2 min-w-0">
          <div className="flex items-center gap-3 bg-card/80 backdrop-blur-md border border-border p-3 rounded-lg shadow-xl pointer-events-auto">
            <div className="w-10 h-10 rounded bg-primary/20 flex items-center justify-center border border-primary/30">
              <Compass className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-widest uppercase text-foreground">TMB Viewer</h1>
              <p className="text-xs text-muted-foreground font-mono">
                NOAA CUDEM •{' '}
                <span
                  className={
                    status.phase === 'error'
                      ? 'text-red-400'
                      : status.phase === 'ready'
                        ? 'text-emerald-400'
                        : 'text-primary'
                  }
                >
                  {status.phase === 'ready'
                    ? 'ONLINE'
                    : status.phase === 'error'
                      ? 'FAULT'
                      : 'LOADING'}
                </span>
              </p>
            </div>
          </div>
          
          <TelemetryOverlay data={telemetry} />
        </div>

        {/* Center Crosshair */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
          <Crosshair className="w-8 h-8 text-primary" />
        </div>
        
        {/* Bottom Controls — desktop, unchanged */}
        <div className="hidden md:flex flex-row justify-between items-end gap-4 mt-auto">
          <div className="flex flex-col gap-4">
            <ControlsPanel 
              state={viewerState} 
              onUpdateLayer={updateLayer} 
              onUpdateDiagnostic={updateDiagnostic} 
            />
            <div className="bg-card/80 backdrop-blur-md border border-border px-4 py-2 rounded-lg text-xs font-mono text-muted-foreground pointer-events-auto shadow-xl w-max">
              <span className="text-foreground">LMB</span>: Orbit &nbsp;|&nbsp; <span className="text-foreground">RMB</span>: Pan &nbsp;|&nbsp; <span className="text-foreground">Scroll</span>: Zoom
              <span className="hidden lg:inline">
                {' '}&nbsp;|&nbsp; <span className="text-foreground">WASD</span>: Fly &nbsp;|&nbsp; <span className="text-foreground">Q / E</span>: Descend / Climb
              </span>
            </div>
          </div>
          
          <LocationsPanel onJump={handleJump} />
        </div>

        {/* Bottom Controls — phone. One panel at a time, over a bar. */}
        <div className="md:hidden mt-auto flex flex-col gap-3">
          {sheet !== null && (
            <div className="pointer-events-auto max-h-[45dvh] overflow-y-auto rounded-lg">
              {sheet === 'layers' ? (
                <ControlsPanel
                  state={viewerState}
                  onUpdateLayer={updateLayer}
                  onUpdateDiagnostic={updateDiagnostic}
                />
              ) : (
                <LocationsPanel onJump={(lat, lon, elev) => {
                  handleJump(lat, lon, elev);
                  // Jumping is the last thing you want the panel for, and
                  // the view you jumped to is behind it.
                  setSheet(null);
                }} />
              )}
            </div>
          )}

          <div className="pointer-events-auto flex items-center gap-2">
            <SheetButton
              icon={<Layers className="w-4 h-4" />}
              label="Layers"
              active={sheet === 'layers'}
              onClick={() => setSheet(sheet === 'layers' ? null : 'layers')}
            />
            <SheetButton
              icon={<MapPin className="w-4 h-4" />}
              label="Places"
              active={sheet === 'places'}
              onClick={() => setSheet(sheet === 'places' ? null : 'places')}
            />
            {sheet !== null && (
              <button
                onClick={() => setSheet(null)}
                aria-label="Close panel"
                className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card/80 text-muted-foreground shadow-xl backdrop-blur-md active:bg-primary/20"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* THE GESTURES ALREADY WORKED; the caption was the problem.
              OrbitControls handles touch natively — one finger orbits,
              two pan and pinch — so a phone was being told to use a
              mouse it does not have. */}
          {sheet === null && (
            <div className="pointer-events-auto w-max rounded-lg border border-border bg-card/80 px-3 py-2 font-mono text-[11px] text-muted-foreground shadow-xl backdrop-blur-md">
              <span className="text-foreground">1 finger</span>: Orbit &nbsp;|&nbsp; <span className="text-foreground">2</span>: Pan &nbsp;|&nbsp; <span className="text-foreground">Pinch</span>: Zoom
            </div>
          )}
        </div>
      </div>

      <div className="absolute left-1/2 top-4 z-20 hidden -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card/80 px-4 py-2 font-mono text-[10px] text-muted-foreground shadow-xl backdrop-blur-md md:flex">
        <span>{status.message}</span>
        <span className="h-3 w-px bg-border" />
        <span>
          TILES {status.activeTiles}/{status.loadedTiles}
        </span>
        <span>LOD {status.maximumActiveLevel}</span>
        {status.riverFeatures > 0 && (
          <span>NHD {status.riverFeatures.toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}

/** One tab of the phone control bar. Forty-four pixels, deliberately. */
function SheetButton({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-11 items-center gap-2 rounded-lg border px-3 text-xs font-medium shadow-xl backdrop-blur-md transition-colors ${
        active
          ? 'border-primary/40 bg-primary/20 text-primary'
          : 'border-border bg-card/80 text-muted-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
