# Kauaʻi terrain and water sources

This viewer uses public United States government geospatial data. Raw source
rasters are not committed; the scripts in `scripts/` make the checked-in,
browser-sized derivatives reproducible.

## Elevation and coastal bathymetry

- **Provider:** NOAA National Centers for Environmental Information (NCEI)
- **Dataset:** Hawaiʻi Continuously Updated Digital Elevation Model (CUDEM),
  ninth arc-second bathymetric-topographic tiles
- **Catalog ID:** `gov.noaa.ngdc.mgg.dem:299919`
- **Source resolution:** 1/9 arc-second (approximately 3 m near Kauaʻi)
- **Viewer pyramid:** EPSG:4326, quantized to 0.25 m, with a maximum derived
  posting of approximately 12 m and coarser overview levels
- **Vertical datum:** local mean sea level (LMSL), as distributed by NOAA
- **Acquisition used by NOAA tiles:** source mosaic version `2021v1`
- **Access:** NOAA Digital Coast public S3 distribution, dataset `9428`
- **License:** United States public-domain government data. NOAA/NCEI citation
  is requested.
- **Rebuild:** `pnpm --filter @workspace/tmb run data:terrain`

The build clips NOAA's overlap margins to exact quarter-degree ownership
bounds, canonicalizes every shared edge sample, records source ETags and
SHA-256 hashes for every derived tile, and contains no wall or skirt geometry.

The terrain and near-shore seafloor come from the same topobathymetric surface,
so the zero-meter coastline is consistent with the rendered bathymetry. The
viewer adds a far-ocean horizon only outside the source coverage; it never uses
a global plane through the island.

NOAA also publishes 2013 USACE NCMP Kauaʻi coastal topobathy at a 1 m grid
(Digital Coast dataset `9335`). It is retained as the preferred future
shoreline-detail source, but it covers the coastal lidar swath rather than the
entire island. The current whole-island pyramid therefore uses the consistent
CUDEM source.

## Rivers and waterway centerlines

- **Provider:** State of Hawaiʻi Office of Planning and Sustainable Development
- **Layer:** NHD Flowlines (`FreshWater/MapServer/10`)
- **Original source:** USGS National Hydrography Dataset, October 2022
- **Features retained:** stream/river, artificial path, connector, and
  canal/ditch centerlines intersecting the Kauaʻi bounding box
- **CRS:** EPSG:4326 in the derived GeoJSON. The state service stores its source
  in NAD83 HARN / UTM zone 4.
- **License:** United States public-domain government data
- **Rebuild:** `pnpm --filter @workspace/tmb run data:hydro`

## Water derivation

Ocean ownership is derived from terrain at or below LMSL. Standing water is
computed once on a fixed, overlap-resolved regional analysis grid at
approximately 50 m posting. Its connected basins and spill elevations are
persisted and reused by every render LOD, so a tile boundary is never treated
as a false outlet. Rivers are seeded from NHD centerlines, honor NHD flow
direction when supplied, and receive a monotonic downstream profile. Ribbon
segments are clipped using center and edge ownership samples. The render
priority is standing water, then river, then ocean; a point is emitted by only
one visual water owner.