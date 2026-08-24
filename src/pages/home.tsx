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
import { Compass, Crosshair } from 'lucide-react';

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
    <div className="relative w-full h-screen overflow-hidden bg-background text-foreground select-none">
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
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 md:p-6">
        
        {/* Top Header & Telemetry */}
        <div className="flex justify-between items-start">
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
        
        {/* Bottom Controls */}
        <div className="flex flex-col md:flex-row justify-between items-end gap-4 mt-auto">
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
