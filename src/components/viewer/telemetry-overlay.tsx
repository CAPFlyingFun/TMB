import { TelemetryData } from '@/lib/three-scene';

export function TelemetryOverlay({ data }: { data: TelemetryData }) {
  const formatCoord = (val: number) => val.toFixed(4);
  const formatNum = (val: number) =>
    Math.round(val).toLocaleString('en-US', { maximumFractionDigits: 0 });

  return (
    <div className="bg-card/80 backdrop-blur-md border border-border p-3 md:p-4 rounded-lg shadow-xl font-mono text-xs flex flex-col gap-2 pointer-events-auto min-w-[190px]">
      <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-1">
        <span className="text-muted-foreground tracking-wider">TELEMETRY</span>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-green-500">SYNC</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px]">LATITUDE</span>
          <span className="text-foreground">{formatCoord(data.lat)}°</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px]">LONGITUDE</span>
          <span className="text-foreground">{formatCoord(data.lon)}°</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px]">CAMERA MSL</span>
          <span className="text-primary font-bold">{formatNum(data.elevation)} m</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px]">GROUND / AGL</span>
          <span className="text-foreground">{formatNum(data.groundElevation)} / {formatNum(data.altitudeAboveGround)} m</span>
        </div>
        <div className="col-span-2 flex items-center justify-between border-t border-white/5 pt-2">
          <span className="text-muted-foreground text-[10px]">HEADING / PITCH</span>
          <span className="text-foreground">{formatNum(data.heading)}° / {formatNum(data.pitch)}°</span>
        </div>
      </div>
    </div>
  );
}
