import {
  geographicToWorld,
  worldToGeographic,
} from '@/lib/geo/coordinates';

export type TerrainBounds = [
  minLongitude: number,
  minLatitude: number,
  maxLongitude: number,
  maxLatitude: number,
];

export type TerrainTileRecord = {
  level: number;
  x: number;
  y: number;
  gridSize: number;
  bounds: TerrainBounds;
  byteLength: number;
  sha256: string;
  url: string;
};

export type TerrainSourceRecord = {
  id: string;
  fileName: string;
  sourceUrl: string;
  sourceMetadata: {
    etag: string | null;
    lastModified: string | null;
    contentLength: number;
  };
  bounds: TerrainBounds;
  nativeGrid: [number, number];
  derivedGrid: [number, number];
  tiles: TerrainTileRecord[];
};

export type TerrainManifest = {
  dataset: string;
  datasetId: string;
  sourceVersion: string;
  retrievedOn: string;
  sourceHorizontalCrs: string;
  sourceVerticalDatum: string;
  sourceResolution: string;
  derivedMaximumPosting: string;
  coverageBounds: TerrainBounds;
  license: string;
  quantization: {
    offsetMeters: number;
    scaleMeters: number;
    noDataValue: number;
  };
  levels: Array<{
    level: number;
    tilesPerAxis: number;
    gridSize: number;
  }>;
  standingWater: StandingWaterAnalysisRecord;
  riverOwnership: RiverOwnershipRecord;
  oceanOwnership: RiverOwnershipRecord;
  sources: TerrainSourceRecord[];
};

export type RiverOwnershipRecord = {
  method: string;
  bounds: TerrainBounds;
  width: number;
  height: number;
  bitOrder: string;
  byteLength: number;
  sha256: string;
  url: string;
};

export type StandingWaterAnalysisRecord = {
  method: string;
  bounds: TerrainBounds;
  width: number;
  height: number;
  posting: string;
  minimumDepthMeters: number;
  minimumConnectedCells: number;
  quantization: TerrainManifest['quantization'];
  byteLength: number;
  sha256: string;
  url: string;
};

export type LoadedTerrainTile = {
  source: TerrainSourceRecord;
  record: TerrainTileRecord;
  heights: Float32Array;
};

function assetUrl(relativePath: string) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(relativePath, base).toString();
}

function contains(
  bounds: TerrainBounds,
  longitude: number,
  latitude: number,
) {
  return (
    longitude >= bounds[0] &&
    longitude <= bounds[2] &&
    latitude >= bounds[1] &&
    latitude <= bounds[3]
  );
}

export class TerrainSource {
  private manifest?: TerrainManifest;
  private loadPromises = new Map<string, Promise<LoadedTerrainTile>>();
  private loadedTiles = new Map<string, LoadedTerrainTile>();
  private abortControllers = new Map<string, AbortController>();
  private standingWaterLevels?: Float32Array;
  private riverOwnershipBits?: Uint8Array;
  private oceanOwnershipBits?: Uint8Array;

  async initialize() {
    const response = await fetch(assetUrl('data/terrain/terrain-manifest.json'));
    if (!response.ok) {
      throw new Error(`Terrain manifest failed to load (${response.status}).`);
    }
    this.manifest = (await response.json()) as TerrainManifest;
    const [standingResponse, ownershipResponse, oceanOwnershipResponse] = await Promise.all([
      fetch(assetUrl(this.manifest.standingWater.url)),
      fetch(assetUrl(this.manifest.riverOwnership.url)),
      fetch(assetUrl(this.manifest.oceanOwnership.url)),
    ]);
    if (!standingResponse.ok) {
      throw new Error(
        `Standing-water analysis failed to load (${standingResponse.status}).`,
      );
    }
    const encoded = new Uint16Array(await standingResponse.arrayBuffer());
    const analysis = this.manifest.standingWater;
    if (encoded.length !== analysis.width * analysis.height) {
      throw new Error('Standing-water analysis has an invalid grid size.');
    }
    this.standingWaterLevels = Float32Array.from(encoded, (value) =>
      value === analysis.quantization.noDataValue
        ? Number.NaN
        : analysis.quantization.offsetMeters +
          value * analysis.quantization.scaleMeters,
    );
    if (!ownershipResponse.ok) {
      throw new Error(
        `River ownership mask failed to load (${ownershipResponse.status}).`,
      );
    }
    this.riverOwnershipBits = new Uint8Array(
      await ownershipResponse.arrayBuffer(),
    );
    if (!oceanOwnershipResponse.ok) {
      throw new Error(
        `Ocean ownership mask failed to load (${oceanOwnershipResponse.status}).`,
      );
    }
    this.oceanOwnershipBits = new Uint8Array(
      await oceanOwnershipResponse.arrayBuffer(),
    );
    return this.manifest;
  }

  getManifest() {
    if (!this.manifest) throw new Error('Terrain source is not initialized.');
    return this.manifest;
  }

  findTile(sourceId: string, level: number, x: number, y: number) {
    const source = this.getManifest().sources.find(
      (entry) => entry.id === sourceId,
    );
    const record = source?.tiles.find(
      (entry) => entry.level === level && entry.x === x && entry.y === y,
    );
    return source && record ? { source, record } : undefined;
  }

  async loadTile(
    source: TerrainSourceRecord,
    record: TerrainTileRecord,
  ): Promise<LoadedTerrainTile> {
    const key = `${source.id}/${record.level}/${record.x}/${record.y}`;
    const existing = this.loadPromises.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    this.abortControllers.set(key, controller);
    const promise = (async () => {
      try {
        const response = await fetch(assetUrl(record.url), {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Terrain tile ${key} failed to load (${response.status}).`,
          );
        }
        const bytes = await response.arrayBuffer();
        const encoded = new Uint16Array(bytes);
        if (encoded.length !== record.gridSize * record.gridSize) {
          throw new Error(`Terrain tile ${key} has an invalid grid size.`);
        }
        const { offsetMeters, scaleMeters, noDataValue } =
          this.getManifest().quantization;
        const heights = new Float32Array(encoded.length);
        for (let index = 0; index < encoded.length; index += 1) {
          heights[index] =
            encoded[index] === noDataValue
              ? Number.NaN
              : offsetMeters + encoded[index] * scaleMeters;
        }
        const loaded = { source, record, heights };
        this.loadedTiles.set(key, loaded);
        return loaded;
      } finally {
        this.abortControllers.delete(key);
      }
    })();

    this.loadPromises.set(key, promise);
    void promise.finally(() => this.loadPromises.delete(key)).catch(() => {});
    return promise;
  }

  evictTile(sourceId: string, level: number, x: number, y: number) {
    const key = `${sourceId}/${level}/${x}/${y}`;
    this.abortControllers.get(key)?.abort();
    this.abortControllers.delete(key);
    this.loadPromises.delete(key);
    this.loadedTiles.delete(key);
  }

  getLoadedTileAtWorld(x: number, z: number) {
    const point = worldToGeographic(x, z);
    let best: LoadedTerrainTile | undefined;
    for (const tile of this.loadedTiles.values()) {
      if (
        contains(tile.record.bounds, point.longitude, point.latitude) &&
        (!best || tile.record.level > best.record.level)
      ) {
        best = tile;
      }
    }
    return best;
  }

  sampleHeightAtWorld(x: number, z: number): number {
    const point = worldToGeographic(x, z);
    const tile = this.getLoadedTileAtWorld(x, z);
    if (!tile) return 0;
    const [minLon, minLat, maxLon, maxLat] = tile.record.bounds;
    const grid = tile.record.gridSize;
    const gx =
      ((point.longitude - minLon) / (maxLon - minLon)) * (grid - 1);
    const gy =
      ((maxLat - point.latitude) / (maxLat - minLat)) * (grid - 1);
    const x0 = Math.max(0, Math.min(grid - 1, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(grid - 1, Math.floor(gy)));
    const x1 = Math.min(grid - 1, x0 + 1);
    const y1 = Math.min(grid - 1, y0 + 1);
    const tx = gx - x0;
    const ty = gy - y0;
    const h00 = tile.heights[y0 * grid + x0];
    const h10 = tile.heights[y0 * grid + x1];
    const h01 = tile.heights[y1 * grid + x0];
    const h11 = tile.heights[y1 * grid + x1];
    if (![h00, h10, h01, h11].every(Number.isFinite)) return 0;
    return (
      h00 * (1 - tx) * (1 - ty) +
      h10 * tx * (1 - ty) +
      h01 * (1 - tx) * ty +
      h11 * tx * ty
    );
  }

  sampleStandingWaterAtGeographic(
    longitude: number,
    latitude: number,
  ): number | undefined {
    const analysis = this.getManifest().standingWater;
    const levels = this.standingWaterLevels;
    if (!levels || !contains(analysis.bounds, longitude, latitude)) {
      return undefined;
    }
    const [minLon, minLat, maxLon, maxLat] = analysis.bounds;
    const x = Math.max(
      0,
      Math.min(
        analysis.width - 1,
        Math.round(
          ((longitude - minLon) / (maxLon - minLon)) * (analysis.width - 1),
        ),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        analysis.height - 1,
        Math.round(
          ((maxLat - latitude) / (maxLat - minLat)) * (analysis.height - 1),
        ),
      ),
    );
    const level = levels[y * analysis.width + x];
    return Number.isFinite(level) ? level : undefined;
  }

  sampleStandingWaterAtWorld(x: number, z: number) {
    const point = worldToGeographic(x, z);
    return this.sampleStandingWaterAtGeographic(
      point.longitude,
      point.latitude,
    );
  }

  isStandingWaterAtWorld(x: number, z: number) {
    return this.sampleStandingWaterAtWorld(x, z) !== undefined;
  }

  getRiverOwnershipGrid() {
    const mask = this.getManifest().riverOwnership;
    const northwest = geographicToWorld(mask.bounds[0], mask.bounds[3]);
    const southeast = geographicToWorld(mask.bounds[2], mask.bounds[1]);
    return {
      originX: northwest.x,
      originZ: northwest.z,
      cellWidth: (southeast.x - northwest.x) / mask.width,
      cellHeight: (southeast.z - northwest.z) / mask.height,
      width: mask.width,
      height: mask.height,
    };
  }

  isRiverOwnershipCell(cellX: number, cellY: number) {
    const mask = this.getManifest().riverOwnership;
    const bytes = this.riverOwnershipBits;
    if (
      !bytes ||
      cellX < 0 ||
      cellY < 0 ||
      cellX >= mask.width ||
      cellY >= mask.height
    ) {
      return false;
    }
    const index = cellY * mask.width + cellX;
    return (bytes[index >> 3] & (1 << (index & 7))) !== 0;
  }

  isOceanAreaOwned(bounds: TerrainBounds) {
    const mask = this.getManifest().oceanOwnership;
    const bytes = this.oceanOwnershipBits;
    if (!bytes) return false;
    const firstX = Math.max(
      0,
      Math.floor(
        ((bounds[0] - mask.bounds[0]) / (mask.bounds[2] - mask.bounds[0])) *
          mask.width,
      ),
    );
    const lastX = Math.min(
      mask.width - 1,
      Math.ceil(
        ((bounds[2] - mask.bounds[0]) / (mask.bounds[2] - mask.bounds[0])) *
          mask.width,
      ) - 1,
    );
    const firstY = Math.max(
      0,
      Math.floor(
        ((mask.bounds[3] - bounds[3]) / (mask.bounds[3] - mask.bounds[1])) *
          mask.height,
      ),
    );
    const lastY = Math.min(
      mask.height - 1,
      Math.ceil(
        ((mask.bounds[3] - bounds[1]) / (mask.bounds[3] - mask.bounds[1])) *
          mask.height,
      ) - 1,
    );
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        const index = y * mask.width + x;
        if ((bytes[index >> 3] & (1 << (index & 7))) === 0) return false;
      }
    }
    return firstX <= lastX && firstY <= lastY;
  }
}