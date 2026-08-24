import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromUrl } from 'geotiff';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'public', 'data', 'terrain');
const DATASET_ROOT =
  'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_ninth_Topobathy_Hawaii_9428/tiles';
const RETRIEVED_ON = '2026-08-24';
const DERIVED_GRID_SIZE = 2049;

const SOURCE_FILES = [
  'ncei19_n22x00_w160x00_2021v1.tif',
  'ncei19_n22x00_w159x75_2021v1.tif',
  'ncei19_n22x00_w159x50_2021v1.tif',
  'ncei19_n22x25_w160x00_2021v1.tif',
  'ncei19_n22x25_w159x75_2021v1.tif',
  'ncei19_n22x25_w159x50_2021v1.tif',
];

const QUANTIZATION = {
  offsetMeters: -12000,
  scaleMeters: 0.25,
  noDataValue: 65535,
};

const LEVELS = [
  { level: 0, tilesPerAxis: 1, gridSize: 129, sourceStep: 16 },
  { level: 1, tilesPerAxis: 2, gridSize: 129, sourceStep: 8 },
  { level: 2, tilesPerAxis: 4, gridSize: 129, sourceStep: 4 },
  { level: 3, tilesPerAxis: 8, gridSize: 257, sourceStep: 1 },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceId(fileName) {
  return fileName.replace(/^ncei19_/, '').replace(/_2021v1\.tif$/, '');
}

function canonicalBounds(fileName) {
  const match = fileName.match(/_n(\d+)x(\d+)_w(\d+)x(\d+)_/);
  if (!match) throw new Error(`Cannot parse NOAA tile name ${fileName}`);
  const north = Number(match[1]) + Number(match[2]) / 100;
  const west = -(Number(match[3]) + Number(match[4]) / 100);
  return [west, north - 0.25, west + 0.25, north];
}

function quantize(value) {
  if (!Number.isFinite(value) || value < -11999) {
    return QUANTIZATION.noDataValue;
  }
  const encoded = Math.round(
    (value - QUANTIZATION.offsetMeters) / QUANTIZATION.scaleMeters,
  );
  return Math.max(0, Math.min(QUANTIZATION.noDataValue - 1, encoded));
}

function tileBounds(sourceBounds, x, y, tilesPerAxis) {
  const [minLon, minLat, maxLon, maxLat] = sourceBounds;
  const lonStep = (maxLon - minLon) / tilesPerAxis;
  const latStep = (maxLat - minLat) / tilesPerAxis;
  return [
    minLon + x * lonStep,
    maxLat - (y + 1) * latStep,
    minLon + (x + 1) * lonStep,
    maxLat - y * latStep,
  ];
}

async function loadSource(fileName) {
  const id = sourceId(fileName);
  const url = `${DATASET_ROOT}/${fileName}`;
  const bounds = canonicalBounds(fileName);
  console.log(`Reading canonical NOAA coverage for ${id}`);
  const [tiff, metadataResponse] = await Promise.all([
    fromUrl(url, { cacheSize: 256 }),
    fetch(url, { method: 'HEAD' }),
  ]);
  if (!metadataResponse.ok) {
    throw new Error(`NOAA metadata request failed for ${id}`);
  }
  const image = await tiff.getImage(0);
  const raster = await tiff.readRasters({
    bbox: bounds,
    width: DERIVED_GRID_SIZE,
    height: DERIVED_GRID_SIZE,
    interleave: true,
    resampleMethod: 'bilinear',
  });
  return {
    id,
    fileName,
    url,
    bounds,
    nativeGrid: [image.getWidth(), image.getHeight()],
    raster: Float32Array.from(raster),
    sourceMetadata: {
      etag: metadataResponse.headers.get('etag'),
      lastModified: metadataResponse.headers.get('last-modified'),
      contentLength: Number(metadataResponse.headers.get('content-length')),
    },
  };
}

function canonicalizeSharedEdges(sources) {
  const edgeSamples = new Map();
  const register = (source, index, globalX, globalY) => {
    const key = `${globalX}:${globalY}`;
    const entries = edgeSamples.get(key) ?? [];
    entries.push([source, index]);
    edgeSamples.set(key, entries);
  };

  for (const source of sources) {
    const [minLon, , , maxLat] = source.bounds;
    const offsetX = Math.round((minLon + 160) * 8192);
    const offsetY = Math.round((22.25 - maxLat) * 8192);
    for (let index = 0; index < DERIVED_GRID_SIZE; index += 1) {
      register(source, index, offsetX + index, offsetY);
      register(
        source,
        (DERIVED_GRID_SIZE - 1) * DERIVED_GRID_SIZE + index,
        offsetX + index,
        offsetY + DERIVED_GRID_SIZE - 1,
      );
      register(
        source,
        index * DERIVED_GRID_SIZE,
        offsetX,
        offsetY + index,
      );
      register(
        source,
        index * DERIVED_GRID_SIZE + DERIVED_GRID_SIZE - 1,
        offsetX + DERIVED_GRID_SIZE - 1,
        offsetY + index,
      );
    }
  }

  for (const entries of edgeSamples.values()) {
    if (entries.length < 2) continue;
    const values = entries
      .map(([source, index]) => source.raster[index])
      .filter(Number.isFinite);
    if (values.length === 0) continue;
    const canonical = values.reduce((sum, value) => sum + value, 0) / values.length;
    for (const [source, index] of entries) {
      source.raster[index] = canonical;
    }
  }
}

async function writeSourcePyramid(source) {
  const sourceEntry = {
    id: source.id,
    fileName: source.fileName,
    sourceUrl: source.url,
    sourceMetadata: source.sourceMetadata,
    bounds: source.bounds,
    nativeGrid: source.nativeGrid,
    derivedGrid: [DERIVED_GRID_SIZE, DERIVED_GRID_SIZE],
    tiles: [],
  };

  for (const level of LEVELS) {
    const levelDir = path.join(OUTPUT_DIR, `z${level.level}`);
    await mkdir(levelDir, { recursive: true });
    const segmentsPerTile = (level.gridSize - 1) * level.sourceStep;

    for (let y = 0; y < level.tilesPerAxis; y += 1) {
      for (let x = 0; x < level.tilesPerAxis; x += 1) {
        const output = new Uint16Array(level.gridSize * level.gridSize);
        const startX = x * segmentsPerTile;
        const startY = y * segmentsPerTile;
        for (let row = 0; row < level.gridSize; row += 1) {
          const sourceY = startY + row * level.sourceStep;
          for (let column = 0; column < level.gridSize; column += 1) {
            const sourceX = startX + column * level.sourceStep;
            output[row * level.gridSize + column] = quantize(
              source.raster[sourceY * DERIVED_GRID_SIZE + sourceX],
            );
          }
        }

        const outputName = `${source.id}-${x}-${y}.bin`;
        const outputPath = path.join(levelDir, outputName);
        const bytes = Buffer.from(
          output.buffer,
          output.byteOffset,
          output.byteLength,
        );
        await writeFile(outputPath, bytes);
        sourceEntry.tiles.push({
          level: level.level,
          x,
          y,
          gridSize: level.gridSize,
          bounds: tileBounds(source.bounds, x, y, level.tilesPerAxis),
          byteLength: output.byteLength,
          sha256: sha256(bytes),
          url: `data/terrain/z${level.level}/${outputName}`,
        });
      }
    }
  }
  return sourceEntry;
}

class FixedMinHeap {
  constructor(capacity) {
    this.indices = new Int32Array(capacity);
    this.elevations = new Float32Array(capacity);
    this.length = 0;
  }

  push(index, elevation) {
    let cursor = this.length++;
    while (cursor > 0) {
      const parent = Math.floor((cursor - 1) / 2);
      if (this.elevations[parent] <= elevation) break;
      this.indices[cursor] = this.indices[parent];
      this.elevations[cursor] = this.elevations[parent];
      cursor = parent;
    }
    this.indices[cursor] = index;
    this.elevations[cursor] = elevation;
  }

  pop() {
    const index = this.indices[0];
    const elevation = this.elevations[0];
    this.length -= 1;
    if (this.length <= 0) return [index, elevation];
    const lastIndex = this.indices[this.length];
    const lastElevation = this.elevations[this.length];
    let cursor = 0;
    while (true) {
      const left = cursor * 2 + 1;
      const right = left + 1;
      if (left >= this.length) break;
      const child =
        right < this.length &&
        this.elevations[right] < this.elevations[left]
          ? right
          : left;
      if (this.elevations[child] >= lastElevation) break;
      this.indices[cursor] = this.indices[child];
      this.elevations[cursor] = this.elevations[child];
      cursor = child;
    }
    this.indices[cursor] = lastIndex;
    this.elevations[cursor] = lastElevation;
    return [index, elevation];
  }
}

function priorityFloodStandingWater(heights, width, height) {
  const filled = new Float32Array(heights);
  const depth = new Float32Array(heights.length);
  const visited = new Uint8Array(heights.length);
  const heap = new FixedMinHeap(heights.length);
  const seed = (index) => {
    if (visited[index] || !Number.isFinite(heights[index])) return;
    visited[index] = 1;
    heap.push(index, heights[index]);
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (heap.length > 0) {
    const [index, elevation] = heap.pop();
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (let direction = 0; direction < 4; direction += 1) {
      if (
        (direction === 0 && x === 0) ||
        (direction === 1 && x === width - 1) ||
        (direction === 2 && y === 0) ||
        (direction === 3 && y === height - 1)
      ) {
        continue;
      }
      const next = neighbors[direction];
      if (visited[next] || !Number.isFinite(heights[next])) continue;
      visited[next] = 1;
      const nextFilled = Math.max(heights[next], elevation);
      filled[next] = nextFilled;
      depth[next] = Math.max(0, nextFilled - heights[next]);
      heap.push(next, nextFilled);
    }
  }

  const state = new Uint8Array(heights.length);
  const waterLevel = new Float32Array(heights.length);
  waterLevel.fill(Number.NaN);
  const queue = new Int32Array(heights.length);
  const component = [];
  const minimumDepth = 1;
  const minimumCells = 8;

  for (let start = 0; start < heights.length; start += 1) {
    if (state[start] || depth[start] < minimumDepth || heights[start] <= 0) {
      continue;
    }
    let head = 0;
    let tail = 1;
    queue[0] = start;
    state[start] = 1;
    component.length = 0;
    let spill = -Infinity;
    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      spill = Math.max(spill, filled[index]);
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let direction = 0; direction < 4; direction += 1) {
        if (
          (direction === 0 && x === 0) ||
          (direction === 1 && x === width - 1) ||
          (direction === 2 && y === 0) ||
          (direction === 3 && y === height - 1)
        ) {
          continue;
        }
        const next = neighbors[direction];
        if (
          !state[next] &&
          depth[next] >= minimumDepth &&
          heights[next] > 0
        ) {
          state[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (component.length >= minimumCells) {
      for (const index of component) waterLevel[index] = spill;
    }
  }
  return waterLevel;
}

async function writeStandingWaterAnalysis(sources) {
  const bounds = [-160, 21.75, -159.25, 22.25];
  const sourceAnalysisSegments = 512;
  const width = sourceAnalysisSegments * 3 + 1;
  const height = sourceAnalysisSegments * 2 + 1;
  const heights = new Float32Array(width * height);
  heights.fill(Number.NaN);

  for (const source of sources) {
    const offsetX = Math.round(
      ((source.bounds[0] - bounds[0]) / 0.25) * sourceAnalysisSegments,
    );
    const offsetY = Math.round(
      ((bounds[3] - source.bounds[3]) / 0.25) * sourceAnalysisSegments,
    );
    for (let row = 0; row <= sourceAnalysisSegments; row += 1) {
      for (let column = 0; column <= sourceAnalysisSegments; column += 1) {
        heights[(offsetY + row) * width + offsetX + column] =
          source.raster[
            row * 4 * DERIVED_GRID_SIZE + column * 4
          ];
      }
    }
  }

  console.log(`Running regional priority flood on ${width} × ${height} cells`);
  const waterLevel = priorityFloodStandingWater(heights, width, height);
  const encoded = Uint16Array.from(waterLevel, quantize);
  const bytes = Buffer.from(
    encoded.buffer,
    encoded.byteOffset,
    encoded.byteLength,
  );
  const fileName = 'standing-water.bin';
  await writeFile(path.join(OUTPUT_DIR, fileName), bytes);
  const analysis = {
    method: 'Regional priority flood with connected-component spill ownership',
    bounds,
    width,
    height,
    posting: 'Approximately 50 meters',
    minimumDepthMeters: 1,
    minimumConnectedCells: 8,
    quantization: QUANTIZATION,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    url: `data/terrain/${fileName}`,
  };
  await writeFile(
    path.join(OUTPUT_DIR, 'standing-water.json'),
    `${JSON.stringify(analysis, null, 2)}\n`,
  );
  return { analysis, waterLevel };
}

async function writeRiverOwnershipMask(sources, standingWaterResult) {
  const cellsAcrossSource = DERIVED_GRID_SIZE - 1;
  const width = cellsAcrossSource * 3;
  const height = cellsAcrossSource * 2;
  const bytes = new Uint8Array(Math.ceil((width * height) / 8));
  const oceanBytes = new Uint8Array(Math.ceil((width * height) / 8));
  const sourceGrid = new Map();
  for (const source of sources) {
    const column = Math.round((source.bounds[0] + 160) / 0.25);
    const row = Math.round((22.25 - source.bounds[3]) / 0.25);
    sourceGrid.set(`${column}:${row}`, source);
  }
  const terrainAtVertex = (globalX, globalY) => {
    const column = Math.min(2, Math.floor(globalX / cellsAcrossSource));
    const row = Math.min(1, Math.floor(globalY / cellsAcrossSource));
    const source = sourceGrid.get(`${column}:${row}`);
    if (!source) return Number.NaN;
    const localX = globalX - column * cellsAcrossSource;
    const localY = globalY - row * cellsAcrossSource;
    return source.raster[localY * DERIVED_GRID_SIZE + localX];
  };
  const standingAtVertex = (globalX, globalY) => {
    const x = Math.max(
      0,
      Math.min(
        1536,
        Math.round((globalX / width) * (standingWaterResult.analysis.width - 1)),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        1024,
        Math.round(
          (globalY / height) * (standingWaterResult.analysis.height - 1),
        ),
      ),
    );
    return Number.isFinite(
      standingWaterResult.waterLevel[
        y * standingWaterResult.analysis.width + x
      ],
    );
  };

  console.log(`Writing authoritative ${width} × ${height} river ownership mask`);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const vertices = [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ];
      const isOwnedLand =
        vertices.every(
          ([vertexX, vertexY]) => terrainAtVertex(vertexX, vertexY) > 0,
        ) &&
        vertices.every(
          ([vertexX, vertexY]) => !standingAtVertex(vertexX, vertexY),
        ) &&
        !standingAtVertex(x + 0.5, y + 0.5);
      if (isOwnedLand) {
        const index = y * width + x;
        bytes[index >> 3] |= 1 << (index & 7);
      }
      if (
        vertices.every(
          ([vertexX, vertexY]) => terrainAtVertex(vertexX, vertexY) <= 0,
        )
      ) {
        const index = y * width + x;
        oceanBytes[index >> 3] |= 1 << (index & 7);
      }
    }
  }
  const fileName = 'river-ownership-mask.bin';
  await writeFile(path.join(OUTPUT_DIR, fileName), bytes);
  const oceanFileName = 'ocean-ownership-mask.bin';
  await writeFile(path.join(OUTPUT_DIR, oceanFileName), oceanBytes);
  const common = {
    bounds: [-160, 21.75, -159.25, 22.25],
    width,
    height,
    bitOrder: 'Least-significant bit first',
  };
  return {
    river: {
    method:
      'Bit-packed finest-cell mask; set only when all terrain vertices are above LMSL and all standing-water probes are absent',
    ...common,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    url: `data/terrain/${fileName}`,
    },
    ocean: {
      method:
        'Bit-packed finest-cell mask; set only when all exact terrain vertices are at or below LMSL',
      ...common,
      byteLength: oceanBytes.byteLength,
      sha256: sha256(oceanBytes),
      url: `data/terrain/${oceanFileName}`,
    },
  };
}

async function main() {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });
  const sources = [];
  for (const fileName of SOURCE_FILES) {
    sources.push(await loadSource(fileName));
  }
  canonicalizeSharedEdges(sources);

  const standingWaterResult = await writeStandingWaterAnalysis(sources);
  const waterOwnership = await writeRiverOwnershipMask(
    sources,
    standingWaterResult,
  );
  const sourceEntries = [];
  for (const source of sources) {
    sourceEntries.push(await writeSourcePyramid(source));
  }

  const manifest = {
    dataset: 'NOAA NCEI CUDEM Hawaiʻi ninth arc-second topobathymetry',
    datasetId: 'gov.noaa.ngdc.mgg.dem:299919',
    sourceVersion: '2021v1',
    retrievedOn: RETRIEVED_ON,
    sourceHorizontalCrs: 'EPSG:4326',
    sourceVerticalDatum: 'Local mean sea level (LMSL)',
    sourceResolution: '1/9 arc-second, approximately 3 meters',
    derivedMaximumPosting: 'Approximately 12 meters',
    coverageBounds: [-160, 21.75, -159.25, 22.25],
    license: 'United States public-domain government data; cite NOAA NCEI',
    quantization: QUANTIZATION,
    levels: LEVELS.map(({ sourceStep: _, ...level }) => level),
    standingWater: standingWaterResult.analysis,
    riverOwnership: waterOwnership.river,
    oceanOwnership: waterOwnership.ocean,
    sources: sourceEntries,
  };
  await writeFile(
    path.join(OUTPUT_DIR, 'terrain-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`Wrote deterministic terrain pyramid to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});