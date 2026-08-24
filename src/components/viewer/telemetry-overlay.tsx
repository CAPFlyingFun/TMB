import { TelemetryData } from '@/lib/three-scene';

export function TelemetryOverlay({ data }: { data: TelemetryData }) {
  const formatCoord = (val: number) => val.toFixed(4);
  const formatNum = (val: number) =>
    Math.round(val).toLocaleString('en-US', { maximumFractionDigits: 0 });

  return (
    <div className="bg-card/80 backdrop-blur-md border border-border p-3 md:p-4 rounded-lg shadow-xl font-mono text-xs flex flex-col gap-2 pointer-events-auto min-w-[150px] md:min-w-[190px]">
      <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-1">
        <span className="text-muted-foreground tracking-wider">TELEMETRY</span>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-green-500">SYNC</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px] whitespace-nowrap">LATITUDE</span>
          <span className="text-foreground">{formatCoord(data.lat)}°</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px] whitespace-nowrap">LONGITUDE</span>
          <span className="text-foreground">{formatCoord(data.lon)}°</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px] whitespace-nowrap">CAMERA MSL</span>
          <span className="text-primary font-bold">{formatNum(data.elevation)} m</span>
        </div>
        {/* FULL WIDTH, like HEADING / PITCH below it. Two numbers and a
            unit will not fit in half a phone-width column: on a 390 px
            screen "0 / 31,000 m" wrapped onto a third line and pushed
            the panel down over the island. */}
        <div className="col-span-2 flex flex-col md:flex-row md:items-center md:justify-between gap-0 md:gap-3">
          <span className="text-muted-foreground text-[10px] whitespace-nowrap">GROUND / AGL</span>
          <span className="text-foreground whitespace-nowrap">{formatNum(data.groundElevation)} / {formatNum(data.altitudeAboveGround)} m</span>
        </div>
        <div className="col-span-2 flex flex-col md:flex-row md:items-center md:justify-between gap-0 md:gap-3 border-t border-white/5 pt-2">
          <span className="text-muted-foreground text-[10px] whitespace-nowrap">HEADING / PITCH</span>
          <span className="text-foreground whitespace-nowrap">{formatNum(data.heading)}° / {formatNum(data.pitch)}°</span>
        </div>
      </div>
    </div>
  );
}
