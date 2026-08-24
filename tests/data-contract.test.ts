import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TerrainManifest } from '../src/lib/terrain/terrain-source';
import { createTerrainTileRenderable } from '../src/lib/terrain/terrain-mesh';
import { MAX_RESIDENT_TILES } from '../src/lib/terrain/terrain-lod';
import { createOceanMaterial } from '../src/lib/water/water-materials';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH = path.join(
  ROOT,
  'public',
  'data',
  'terrain',
  'terrain-manifest.json',
);

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as TerrainManifest;
}

describe('terrain pyramid data contract', () => {
  it('covers six NOAA source tiles with a bounded quadtree payload', async () => {
    const manifest = await readManifest();
    expect(manifest.sources).toHaveLength(6);
    expect(manifest.sourceHorizontalCrs).toBe('EPSG:4326');
    expect(manifest.levels.map((level) => level.level)).toEqual([0, 1, 2, 3]);
    expect(MAX_RESIDENT_TILES).toBe(96);
    expect(manifest.coverageBounds).toEqual([-160, 21.75, -159.25, 22.25]);

    for (const source of manifest.sources) {
      expect(source.tiles).toHaveLength(85);
      for (const tile of source.tiles) {
        expect(tile.gridSize).toBeLessThanOrEqual(257);
        expect(tile.byteLength).toBe(tile.gridSize * tile.gridSize * 2);
        expect(tile.byteLength).toBeLessThanOrEqual(132_098);
        const file = path.join(ROOT, 'public', tile.url);
        expect((await stat(file)).size).toBe(tile.byteLength);
      }
    }
  });

  it('has exact, non-overlapping source ownership and identical seam samples', async () => {
    const manifest = await readManifest();
    const roots = new Map<string, Uint16Array>();
    for (const source of manifest.sources) {
      const root = source.tiles.find((tile) => tile.level === 0)!;
      const buffer = await readFile(path.join(ROOT, 'public', root.url));
      roots.set(
        source.id,
        new Uint16Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / 2,
        ),
      );
    }

    for (let firstIndex = 0; firstIndex < manifest.sources.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < manifest.sources.length;
        secondIndex += 1
      ) {
        const first = manifest.sources[firstIndex];
        const second = manifest.sources[secondIndex];
        const longitudeOverlap = Math.max(
          0,
          Math.min(first.bounds[2], second.bounds[2]) -
            Math.max(first.bounds[0], second.bounds[0]),
        );
        const latitudeOverlap = Math.max(
          0,
          Math.min(first.bounds[3], second.bounds[3]) -
            Math.max(first.bounds[1], second.bounds[1]),
        );
        expect(longitudeOverlap * latitudeOverlap).toBe(0);

        const firstRoot = roots.get(first.id)!;
        const secondRoot = roots.get(second.id)!;
        const grid = 129;
        if (
          first.bounds[2] === second.bounds[0] &&
          first.bounds[1] === second.bounds[1]
        ) {
          for (let row = 0; row < grid; row += 1) {
            expect(firstRoot[row * grid + grid - 1]).toBe(
              secondRoot[row * grid],
            );
          }
        }
        if (
          first.bounds[1] === second.bounds[3] &&
          first.bounds[0] === second.bounds[0]
        ) {
          for (let column = 0; column < grid; column += 1) {
            expect(firstRoot[column]).toBe(
              secondRoot[(grid - 1) * grid + column],
            );
          }
        }
      }
    }
  });

  it('persists one regional basin/spill analysis for every terrain LOD', async () => {
    const manifest = await readManifest();
    const analysis = manifest.standingWater;
    expect(analysis.bounds).toEqual(manifest.coverageBounds);
    expect(analysis.width * analysis.height * 2).toBe(analysis.byteLength);
    const file = await readFile(path.join(ROOT, 'public', analysis.url));
    expect(file.byteLength).toBe(analysis.byteLength);
    const encoded = new Uint16Array(
      file.buffer,
      file.byteOffset,
      file.byteLength / 2,
    );
    const waterCells = Array.from(encoded).filter(
      (value) => value !== analysis.quantization.noDataValue,
    );
    expect(waterCells.length).toBeGreaterThan(0);
    const ownership = manifest.riverOwnership;
    const ownershipFile = await readFile(
      path.join(ROOT, 'public', ownership.url),
    );
    expect(ownershipFile.byteLength).toBe(
      Math.ceil((ownership.width * ownership.height) / 8),
    );
  });

  it('contains both land and bathymetry without side-wall geometry samples', async () => {
    const manifest = await readManifest();
    const source = manifest.sources.find((entry) =>
      entry.id.includes('n22x00_w159x75'),
    );
    const root = source?.tiles.find((tile) => tile.level === 0);
    expect(source).toBeDefined();
    expect(root).toBeDefined();
    const buffer = await readFile(path.join(ROOT, 'public', root!.url));
    const encoded = new Uint16Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 2,
    );
    const elevations = Array.from(encoded, (value) =>
      value === manifest.quantization.noDataValue
        ? Number.NaN
        : manifest.quantization.offsetMeters +
          value * manifest.quantization.scaleMeters,
    ).filter(Number.isFinite);
    expect(Math.min(...elevations)).toBeLessThan(0);
    expect(Math.max(...elevations)).toBeGreaterThan(500);
    expect(encoded).toHaveLength(root!.gridSize * root!.gridSize);
  });

  it('builds an indexed surface mesh and coastline-masked ocean without WebGL', async () => {
    const manifest = await readManifest();
    const source = manifest.sources.find((entry) =>
      entry.id.includes('n22x00_w159x75'),
    )!;
    const record = source.tiles.find((tile) => tile.level === 0)!;
    const buffer = await readFile(path.join(ROOT, 'public', record.url));
    const encoded = new Uint16Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 2,
    );
    const heights = Float32Array.from(encoded, (value) =>
      value === manifest.quantization.noDataValue
        ? Number.NaN
        : manifest.quantization.offsetMeters +
          value * manifest.quantization.scaleMeters,
    );
    const oceanMaterial = createOceanMaterial();
    const renderable = createTerrainTileRenderable(
      { source, record, heights },
      oceanMaterial,
      () => undefined,
      () => true,
    );
    const terrainPositions = renderable.terrain.geometry.getAttribute('position');
    expect(terrainPositions.count).toBe(record.gridSize * record.gridSize);
    expect(renderable.terrain.geometry.index!.count).toBeGreaterThan(0);
    expect(renderable.ocean?.geometry.index!.count).toBeGreaterThan(0);
    expect(terrainPositions.count).toBeLessThanOrEqual(66_049);
    renderable.dispose();
    oceanMaterial.dispose();
  });
});