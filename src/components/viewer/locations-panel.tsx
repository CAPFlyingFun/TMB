import { MapPin } from 'lucide-react';

interface LocationsPanelProps {
  onJump: (lat: number, lon: number, elev: number) => void;
}

const LOCATIONS = [
  { name: 'Līhuʻe Airport', lat: 21.9811, lon: -159.3711, elev: 2_000 },
  { name: 'Waimea Canyon', lat: 22.0594, lon: -159.6586, elev: 2_700 },
  { name: 'Nā Pali Coast', lat: 22.1742, lon: -159.6456, elev: 2_400 },
  { name: 'Mt. Waiʻaleʻale', lat: 22.0733, lon: -159.4977, elev: 2_200 },
];

export function LocationsPanel({ onJump }: LocationsPanelProps) {
  return (
    <div className="bg-card/80 backdrop-blur-md border border-border p-4 rounded-lg shadow-xl w-64 pointer-events-auto flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-bold text-foreground border-b border-white/5 pb-2">
        <MapPin className="w-4 h-4 text-primary" />
        SAVED VECTORS
      </div>
      <div className="flex flex-col gap-2">
        {LOCATIONS.map((loc) => (
          <button
            key={loc.name}
            onClick={() => onJump(loc.lat, loc.lon, loc.elev)}
            className="flex items-center justify-between p-2 rounded bg-muted/50 hover:bg-primary/20 border border-transparent hover:border-primary/30 transition-all group text-left"
          >
            <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{loc.name}</span>
            <span className="text-[10px] font-mono text-muted-foreground">JUMP</span>
          </button>
        ))}
      </div>
    </div>
  );
}
