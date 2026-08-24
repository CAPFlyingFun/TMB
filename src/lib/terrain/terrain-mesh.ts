import * as THREE from 'three';
import { geographicToWorld } from '@/lib/geo/coordinates';
import type { LoadedTerrainTile } from '@/lib/terrain/terrain-source';
import type { ViewerState } from '@/lib/three-scene';
import type { OceanMaterial } from '@/lib/water/water-materials';
import { createStandingWaterMaterial } from '@/lib/water/water-materials';

export type TerrainTileRenderable = {
  group: THREE.Group;
  terrain: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ocean?: THREE.Mesh<THREE.BufferGeometry, OceanMaterial>;
  standingWater?: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshPhysicalMaterial
  >;
  boundary: THREE.LineLoop;
  dispose: () => void;
  applyState: (state: ViewerState) => void;
  setLodFallback: (fallback: boolean) => void;
};

function terrainColor(
  elevation: number,
  slope: number,
  longitude: number,
  latitude: number,
) {
  const color = new THREE.Color();
  if (elevation < -180) color.set(0x071b27);
  else if (elevation < -20) color.set(0x0b3140);
  else if (elevation < 1.5) color.set(0xb4a16e);
  else if (elevation < 90) color.set(0x2d6035);
  else if (elevation < 320) color.set(0x31512d);
  else if (elevation < 760) color.set(0x505638);
  else if (elevation < 1_150) color.set(0x665f4c);
  else color.set(0x878276);

  const coordinateVariation =
    Math.sin(longitude * 913.7 + latitude * 527.1) * 0.035;
  const slopeShade = Math.min(0.2, slope * 0.018);
  color.offsetHSL(coordinateVariation, 0, coordinateVariation - slopeShade);
  return color;
}

function createTerrainGeometry(tile: LoadedTerrainTile) {
  const { gridSize, bounds } = tile.record;
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const vertexCount = gridSize * gridSize;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  for (let row = 0; row < gridSize; row += 1) {
    const latitude =
      maxLat - (row / (gridSize - 1)) * (maxLat - minLat);
    for (let column = 0; column < gridSize; column += 1) {
      const longitude =
        minLon + (column / (gridSize - 1)) * (maxLon - minLon);
      const index = row * gridSize + column;
      const world = geographicToWorld(longitude, latitude);
      const elevation = tile.heights[index];
      const left = tile.heights[row * gridSize + Math.max(0, column - 1)];
      const right =
        tile.heights[row * gridSize + Math.min(gridSize - 1, column + 1)];
      const up =
        tile.heights[Math.max(0, row - 1) * gridSize + column];
      const down =
        tile.heights[Math.min(gridSize - 1, row + 1) * gridSize + column];
      const slope =
        [left, right, up, down].every(Number.isFinite)
          ? Math.abs(right - left) + Math.abs(down - up)
          : 0;
      const color = terrainColor(
        Number.isFinite(elevation) ? elevation : -200,
        slope,
        longitude,
        latitude,
      );

      positions[index * 3] = world.x;
      positions[index * 3 + 1] = Number.isFinite(elevation) ? elevation : -200;
      positions[index * 3 + 2] = world.z;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
  }

  for (let row = 0; row < gridSize - 1; row += 1) {
    for (let column = 0; column < gridSize - 1; column += 1) {
      const a = row * gridSize + column;
      const b = a + 1;
      const c = a + gridSize;
      const d = c + 1;
      if ([a, b, c, d].every((index) => Number.isFinite(tile.heights[index]))) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createOceanGeometry(
  tile: LoadedTerrainTile,
  isOceanAreaOwned: (bounds: [number, number, number, number]) => boolean,
) {
  const { gridSize, bounds } = tile.record;
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const positions = new Float32Array(gridSize * gridSize * 3);
  const depths = new Float32Array(gridSize * gridSize);
  const indices: number[] = [];

  for (let row = 0; row < gridSize; row += 1) {
    const latitude =
      maxLat - (row / (gridSize - 1)) * (maxLat - minLat);
    for (let column = 0; column < gridSize; column += 1) {
      const longitude =
        minLon + (column / (gridSize - 1)) * (maxLon - minLon);
      const index = row * gridSize + column;
      const world = geographicToWorld(longitude, latitude);
      positions[index * 3] = world.x;
      positions[index * 3 + 1] = 0.15;
      positions[index * 3 + 2] = world.z;
      depths[index] = Math.max(0, -tile.heights[index]);
    }
  }

  for (let row = 0; row < gridSize - 1; row += 1) {
    for (let column = 0; column < gridSize - 1; column += 1) {
      const a = row * gridSize + column;
      const b = a + 1;
      const c = a + gridSize;
      const d = c + 1;
      const cellBounds: [number, number, number, number] = [
        minLon + (column / (gridSize - 1)) * (maxLon - minLon),
        maxLat - ((row + 1) / (gridSize - 1)) * (maxLat - minLat),
        minLon + ((column + 1) / (gridSize - 1)) * (maxLon - minLon),
        maxLat - (row / (gridSize - 1)) * (maxLat - minLat),
      ];
      if (isOceanAreaOwned(cellBounds)) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  if (indices.length === 0) return undefined;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createStandingWaterGeometry(
  tile: LoadedTerrainTile,
  sampleStandingWater: (
    longitude: number,
    latitude: number,
  ) => number | undefined,
) {
  const { gridSize, bounds } = tile.record;
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const positions = new Float32Array(gridSize * gridSize * 3);
  const waterLevels = new Float32Array(gridSize * gridSize);
  waterLevels.fill(Number.NaN);
  const indices: number[] = [];

  for (let row = 0; row < gridSize; row += 1) {
    const latitude =
      maxLat - (row / (gridSize - 1)) * (maxLat - minLat);
    for (let column = 0; column < gridSize; column += 1) {
      const longitude =
        minLon + (column / (gridSize - 1)) * (maxLon - minLon);
      const index = row * gridSize + column;
      const world = geographicToWorld(longitude, latitude);
      const waterLevel = sampleStandingWater(longitude, latitude);
      if (waterLevel !== undefined) waterLevels[index] = waterLevel;
      positions[index * 3] = world.x;
      positions[index * 3 + 1] = (waterLevel ?? tile.heights[index]) + 0.12;
      positions[index * 3 + 2] = world.z;
    }
  }

  for (let row = 0; row < gridSize - 1; row += 1) {
    for (let column = 0; column < gridSize - 1; column += 1) {
      const a = row * gridSize + column;
      const b = a + 1;
      const c = a + gridSize;
      const d = c + 1;
      const levels = [a, b, c, d].map((index) => waterLevels[index]);
      if (
        levels.every(Number.isFinite) &&
        Math.max(...levels) - Math.min(...levels) <= 0.5
      ) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  if (indices.length === 0) return undefined;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createBoundary(tile: LoadedTerrainTile) {
  const [minLon, minLat, maxLon, maxLat] = tile.record.bounds;
  const corners = [
    geographicToWorld(minLon, minLat),
    geographicToWorld(minLon, maxLat),
    geographicToWorld(maxLon, maxLat),
    geographicToWorld(maxLon, minLat),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(
    corners.map((corner) => new THREE.Vector3(corner.x, 6, corner.z)),
  );
  const material = new THREE.LineBasicMaterial({
    color: 0x42ff9a,
    transparent: true,
    opacity: 0.72,
  });
  return new THREE.LineLoop(geometry, material);
}

export function createTerrainTileRenderable(
  tile: LoadedTerrainTile,
  oceanMaterial: OceanMaterial,
  sampleStandingWater: (
    longitude: number,
    latitude: number,
  ) => number | undefined,
  isOceanAreaOwned: (bounds: [number, number, number, number]) => boolean,
): TerrainTileRenderable {
  const group = new THREE.Group();
  const terrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    polygonOffset: tile.record.level > 0,
    polygonOffsetFactor: -tile.record.level,
    polygonOffsetUnits: -tile.record.level,
  });
  const terrain = new THREE.Mesh(createTerrainGeometry(tile), terrainMaterial);
  terrain.receiveShadow = true;
  group.add(terrain);

  const oceanGeometry = createOceanGeometry(tile, isOceanAreaOwned);
  const ocean = oceanGeometry
    ? new THREE.Mesh(oceanGeometry, oceanMaterial)
    : undefined;
  if (ocean) group.add(ocean);

  const standingGeometry = createStandingWaterGeometry(
    tile,
    sampleStandingWater,
  );
  const standingMaterial = standingGeometry
    ? createStandingWaterMaterial()
    : undefined;
  const standingWater =
    standingGeometry && standingMaterial
      ? new THREE.Mesh(standingGeometry, standingMaterial)
      : undefined;
  if (standingWater) group.add(standingWater);

  const boundary = createBoundary(tile);
  group.add(boundary);

  let currentState: ViewerState | undefined;
  let lodFallback = false;
  const applyState = (state: ViewerState) => {
    currentState = state;
    terrain.visible = state.layers.terrain;
    terrainMaterial.wireframe = state.diagnostics.wireframe;
    if (ocean) ocean.visible = state.layers.ocean && !lodFallback;
    if (standingWater) {
      standingWater.visible = state.layers.standingWater && !lodFallback;
      standingMaterial!.color.setHex(
        state.diagnostics.waterOwnership
          ? 0x10f0d0
          : state.diagnostics.spillLevels
            ? 0xe14fff
            : 0x1aa8b6,
      );
    }
    boundary.visible = state.diagnostics.tileBoundaries && !lodFallback;
  };
  const setLodFallback = (fallback: boolean) => {
    lodFallback = fallback;
    if (currentState) applyState(currentState);
  };

  const dispose = () => {
    terrain.geometry.dispose();
    terrainMaterial.dispose();
    oceanGeometry?.dispose();
    standingGeometry?.dispose();
    standingMaterial?.dispose();
    boundary.geometry.dispose();
    (boundary.material as THREE.Material).dispose();
  };

  return {
    group,
    terrain,
    ocean,
    standingWater,
    boundary,
    dispose,
    applyState,
    setLodFallback,
  };
}