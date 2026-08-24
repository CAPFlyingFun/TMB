# TMB Kauaʻi Terrain Viewer

A terrain-first WebGL viewer for inspecting Kauaʻi topography, basin-contained
standing water, authoritative NHD river centerlines, and coastline-aware ocean
coverage. This repository intentionally contains no ant gameplay yet.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. A WebGL-capable browser and GPU context are
required for the terrain renderer.

## Controls

- Left drag: orbit
- Right drag: pan
- Scroll: zoom
- `W` / `A` / `S` / `D`: fly
- `Q` / `E`: descend / climb
- Saved vectors jump to Līhuʻe, Waimea Canyon, Nā Pali, and Waiʻaleʻale

Layer and diagnostic controls expose terrain, rivers, standing water, ocean,
tile boundaries, water ownership, spill levels, and wireframe mode.

## Data and deterministic rebuilds

The checked-in browser derivatives come from NOAA NCEI CUDEM Hawaiʻi
ninth-arc-second topobathymetry and Hawaiʻi's public USGS NHD flowline service.
See [`data/SOURCES.md`](data/SOURCES.md) for provenance, datums, licenses,
resolution, acquisition metadata, checksums, and rebuild commands.

```bash
npm run data:terrain
npm run data:hydro
npm test
npm run typecheck
npm run build
```

The terrain build removes overlapping NOAA margins, canonicalizes shared edge
samples, writes a bounded quadtree, and persists one regional basin/spill
analysis reused at every render LOD.