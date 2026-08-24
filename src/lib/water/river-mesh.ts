import * as THREE from 'three';
import { geographicToWorld } from '@/lib/geo/coordinates';
import {
  gradeRiverProfile,
} from '@/lib/hydrology/river-network';
import type { TerrainSource } from '@/lib/terrain/terrain-source';
import { createRiverMaterial } from '@/lib/water/water-materials';
import {
  rasterizeOwnedRibbonCells,
  type OwnedRibbonCell,
} from '@/lib/water/ribbon-ownership';

type FlowlineProperties = {
  name?: string | null;
  lengthKm?: number;
  featureType?: number;
  mainPath?: number;
  flowDirection?: number;
};

type FlowlineFeature = {
  type: 'Feature';
  properties: FlowlineProperties;
  geometry: {
    type: 'LineString' | 'MultiLineString';
    coordinates: number[][] | number[][][];
  };
};

type FlowlineCollection = {
  type: 'FeatureCollection';
  features: FlowlineFeature[];
};

function assetUrl(relativePath: string) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(relativePath, base).toString();
}

function mergeOwnedCells(
  target: Map<string, OwnedRibbonCell>,
  cells: OwnedRibbonCell[],
  elevationOffset = 0,
) {
  for (const cell of cells) {
    const heights = cell.heights.map(
      (height) => height + elevationOffset,
    ) as OwnedRibbonCell['heights'];
    const existing = target.get(cell.key);
    if (!existing) {
      target.set(cell.key, { ...cell, heights });
      continue;
    }
    existing.heights = existing.heights.map((height, index) =>
      Math.min(height, heights[index]),
    ) as OwnedRibbonCell['heights'];
  }
}

function appendOwnedCells(
  cells: Map<string, OwnedRibbonCell>,
  positions: number[],
  indices: number[],
) {
  for (const cell of cells.values()) {
    const base = positions.length / 3;
    positions.push(
      cell.x,
      cell.heights[0],
      cell.z,
      cell.x + cell.width,
      cell.heights[1],
      cell.z,
      cell.x,
      cell.heights[2],
      cell.z + cell.height,
      cell.x + cell.width,
      cell.heights[3],
      cell.z + cell.height,
    );
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}

export async function createRiverNetworkMesh(
  terrain: TerrainSource,
  isStandingWaterAtWorld: (x: number, z: number) => boolean,
) {
  const response = await fetch(
    assetUrl('data/hydrology/nhd-flowlines-kauai.geojson'),
  );
  if (!response.ok) {
    throw new Error(`Hydrography failed to load (${response.status}).`);
  }
  const collection = (await response.json()) as FlowlineCollection;
  const waterPositions: number[] = [];
  const waterIndices: number[] = [];
  const bankPositions: number[] = [];
  const bankIndices: number[] = [];
  const waterCells = new Map<string, OwnedRibbonCell>();
  const bankCells = new Map<string, OwnedRibbonCell>();
  const ownershipGrid = terrain.getRiverOwnershipGrid();

  for (const feature of collection.features) {
    const lines =
      feature.geometry.type === 'MultiLineString'
        ? (feature.geometry.coordinates as number[][][])
        : [feature.geometry.coordinates as number[][]];
    const riverWidth =
      feature.properties.mainPath === 1 || feature.properties.name
        ? 12
        : feature.properties.featureType === 460
          ? 7
          : 4.5;

    for (const line of lines) {
      if (line.length < 2) continue;
      let points = line.map(([longitude, latitude]) => {
        const world = geographicToWorld(longitude, latitude);
        return new THREE.Vector3(
          world.x,
          terrain.sampleHeightAtWorld(world.x, world.z),
          world.z,
        );
      });
      const hasAuthoritativeDirection =
        feature.properties.flowDirection === 1 ||
        feature.properties.flowDirection === 2;
      if (feature.properties.flowDirection === 2) points.reverse();
      const graded = gradeRiverProfile(
        points.map((point) => point.y),
        0.05,
        0.35,
        !hasAuthoritativeDirection,
      );
      if (graded.reversed) points = points.reverse();
      points.forEach((point, index) => {
        point.y = graded.heights[index];
      });

      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        mergeOwnedCells(
          waterCells,
          rasterizeOwnedRibbonCells(
            start,
            end,
            riverWidth,
            ownershipGrid,
            (cellX, cellY) => terrain.isRiverOwnershipCell(cellX, cellY),
          ),
        );
        mergeOwnedCells(
          bankCells,
          rasterizeOwnedRibbonCells(
            start,
            end,
            riverWidth + 8,
            ownershipGrid,
            (cellX, cellY) => terrain.isRiverOwnershipCell(cellX, cellY),
          ),
          -0.28,
        );
      }
    }
  }
  appendOwnedCells(waterCells, waterPositions, waterIndices);
  appendOwnedCells(bankCells, bankPositions, bankIndices);

  const group = new THREE.Group();
  const bankGeometry = new THREE.BufferGeometry();
  bankGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(bankPositions, 3),
  );
  bankGeometry.setIndex(bankIndices);
  bankGeometry.computeVertexNormals();
  const bankMaterial = new THREE.MeshStandardMaterial({
    color: 0x28342a,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const banks = new THREE.Mesh(bankGeometry, bankMaterial);
  group.add(banks);

  const waterGeometry = new THREE.BufferGeometry();
  waterGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(waterPositions, 3),
  );
  waterGeometry.setIndex(waterIndices);
  waterGeometry.computeVertexNormals();
  const waterMaterial = createRiverMaterial();
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  group.add(water);

  return {
    group,
    water,
    banks,
    featureCount: collection.features.length,
    dispose() {
      bankGeometry.dispose();
      bankMaterial.dispose();
      waterGeometry.dispose();
      waterMaterial.dispose();
    },
  };
}