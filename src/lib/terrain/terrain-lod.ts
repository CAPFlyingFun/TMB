import * as THREE from 'three';
import { geographicToWorld } from '@/lib/geo/coordinates';
import {
  createTerrainTileRenderable,
  type TerrainTileRenderable,
} from '@/lib/terrain/terrain-mesh';
import {
  TerrainSource,
  type LoadedTerrainTile,
  type TerrainSourceRecord,
  type TerrainTileRecord,
} from '@/lib/terrain/terrain-source';
import type { ViewerState } from '@/lib/three-scene';
import type { OceanMaterial } from '@/lib/water/water-materials';

type TerrainNode = {
  source: TerrainSourceRecord;
  record: TerrainTileRecord;
  renderable: TerrainTileRenderable;
  children?: TerrainNode[];
  loadingChildren?: Promise<TerrainNode[]>;
  fallback: boolean;
};

export type TerrainLodStats = {
  loadedTiles: number;
  activeTiles: number;
  maximumActiveLevel: number;
};

const REFINEMENT_DISTANCE = [58_000, 24_000, 8_500];
export const MAX_RESIDENT_TILES = 96;

export class TerrainLodManager {
  readonly source = new TerrainSource();
  private readonly roots: TerrainNode[] = [];
  private currentState: ViewerState;
  private disposed = false;
  private pendingTileCount = 0;

  constructor(
    private readonly worldRoot: THREE.Group,
    private readonly oceanMaterial: OceanMaterial,
    initialState: ViewerState,
    private readonly onProgress?: (stats: TerrainLodStats) => void,
  ) {
    this.currentState = initialState;
  }

  async initialize() {
    const manifest = await this.source.initialize();
    const roots = await Promise.all(
      manifest.sources.map(async (source) => {
        const record = source.tiles.find(
          (tile) => tile.level === 0 && tile.x === 0 && tile.y === 0,
        );
        if (!record) throw new Error(`Terrain source ${source.id} has no root.`);
        return this.loadNode(source, record);
      }),
    );
    if (this.disposed) {
      roots.forEach((node) => node.renderable.dispose());
      return manifest;
    }
    for (const root of roots) {
      root.renderable.group.visible = true;
      this.roots.push(root);
    }
    this.emitProgress();
    return manifest;
  }

  private async loadNode(
    source: TerrainSourceRecord,
    record: TerrainTileRecord,
  ): Promise<TerrainNode> {
    const tile = await this.source.loadTile(source, record);
    return this.createNode(tile);
  }

  private createNode(tile: LoadedTerrainTile): TerrainNode {
    const renderable = createTerrainTileRenderable(
      tile,
      this.oceanMaterial,
      (longitude, latitude) =>
        this.source.sampleStandingWaterAtGeographic(longitude, latitude),
      (bounds) => this.source.isOceanAreaOwned(bounds),
    );
    renderable.group.visible = false;
    renderable.applyState(this.currentState);
    this.worldRoot.add(renderable.group);
    return {
      source: tile.source,
      record: tile.record,
      renderable,
      fallback: false,
    };
  }

  private shouldRefine(node: TerrainNode, cameraGlobal: THREE.Vector3) {
    if (node.record.level >= 3) return false;
    const [minLon, minLat, maxLon, maxLat] = node.record.bounds;
    const center = geographicToWorld(
      (minLon + maxLon) * 0.5,
      (minLat + maxLat) * 0.5,
    );
    const horizontal = Math.hypot(
      cameraGlobal.x - center.x,
      cameraGlobal.z - center.z,
    );
    const effectiveDistance = Math.hypot(
      horizontal,
      Math.max(0, cameraGlobal.y) * 0.55,
    );
    return effectiveDistance < REFINEMENT_DISTANCE[node.record.level];
  }

  update(cameraGlobal: THREE.Vector3, state: ViewerState) {
    this.currentState = state;
    for (const root of this.roots) {
      this.updateNode(root, cameraGlobal);
    }
    this.emitProgress();
  }

  private updateNode(node: TerrainNode, cameraGlobal: THREE.Vector3) {
    if (this.shouldRefine(node, cameraGlobal)) {
      if (node.children) {
        node.renderable.group.visible = true;
        node.fallback = true;
        node.renderable.setLodFallback(true);
        for (const child of node.children) {
          child.renderable.group.visible = true;
          child.fallback = false;
          child.renderable.setLodFallback(false);
          this.updateNode(child, cameraGlobal);
        }
      } else {
        void this.refine(node);
      }
      return;
    }

    node.renderable.group.visible = true;
    node.fallback = false;
    node.renderable.setLodFallback(false);
    this.cancelRefinement(node);
    this.disposeDescendants(node);
  }

  private cancelRefinement(node: TerrainNode) {
    if (!node.loadingChildren) return;
    const nextLevel = node.record.level + 1;
    for (const [x, y] of [
      [node.record.x * 2, node.record.y * 2],
      [node.record.x * 2 + 1, node.record.y * 2],
      [node.record.x * 2, node.record.y * 2 + 1],
      [node.record.x * 2 + 1, node.record.y * 2 + 1],
    ]) {
      this.source.evictTile(node.source.id, nextLevel, x, y);
    }
  }

  private disposeDescendants(node: TerrainNode) {
    for (const child of node.children ?? []) {
      this.disposeDescendants(child);
      this.worldRoot.remove(child.renderable.group);
      child.renderable.dispose();
      this.source.evictTile(
        child.source.id,
        child.record.level,
        child.record.x,
        child.record.y,
      );
    }
    node.children = undefined;
  }

  private async refine(node: TerrainNode) {
    if (
      node.loadingChildren ||
      node.children ||
      this.disposed ||
      this.getStats().loadedTiles + this.pendingTileCount + 4 >
        MAX_RESIDENT_TILES
    ) {
      return;
    }
    const nextLevel = node.record.level + 1;
    const childRecords = [
      [node.record.x * 2, node.record.y * 2],
      [node.record.x * 2 + 1, node.record.y * 2],
      [node.record.x * 2, node.record.y * 2 + 1],
      [node.record.x * 2 + 1, node.record.y * 2 + 1],
    ]
      .map(([x, y]) => this.source.findTile(node.source.id, nextLevel, x, y))
      .filter(
        (
          entry,
        ): entry is { source: TerrainSourceRecord; record: TerrainTileRecord } =>
          Boolean(entry),
      );
    if (childRecords.length !== 4) return;

    this.pendingTileCount += 4;
    node.loadingChildren = Promise.all(
      childRecords.map(({ source, record }) =>
        this.source.loadTile(source, record),
      ),
    ).then((tiles) => tiles.map((tile) => this.createNode(tile)));
    try {
      const children = await node.loadingChildren;
      if (this.disposed) {
        children.forEach((child) => child.renderable.dispose());
        return;
      }
      node.children = children;
      node.renderable.group.visible = true;
      node.fallback = true;
      node.renderable.setLodFallback(true);
      children.forEach((child) => {
        child.renderable.group.visible = true;
        child.renderable.setLodFallback(false);
      });
      this.emitProgress();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Terrain refinement failed', error);
      }
    } finally {
      this.pendingTileCount -= 4;
      node.loadingChildren = undefined;
    }
  }

  applyState(state: ViewerState) {
    this.currentState = state;
    const visit = (node: TerrainNode) => {
      node.renderable.applyState(state);
      node.children?.forEach(visit);
    };
    this.roots.forEach(visit);
    this.oceanMaterial.uniforms.uOwnershipDiagnostic.value =
      state.diagnostics.waterOwnership ? 1 : 0;
  }

  getStats(): TerrainLodStats {
    let loadedTiles = 0;
    let activeTiles = 0;
    let maximumActiveLevel = 0;
    const visit = (node: TerrainNode) => {
      loadedTiles += 1;
      if (node.renderable.group.visible && !node.fallback) {
        activeTiles += 1;
        maximumActiveLevel = Math.max(maximumActiveLevel, node.record.level);
      }
      node.children?.forEach(visit);
    };
    this.roots.forEach(visit);
    return { loadedTiles, activeTiles, maximumActiveLevel };
  }

  private emitProgress() {
    this.onProgress?.(this.getStats());
  }

  isStandingWaterAtWorld(x: number, z: number) {
    return this.source.isStandingWaterAtWorld(x, z);
  }

  dispose() {
    this.disposed = true;
    const visit = (node: TerrainNode) => {
      this.worldRoot.remove(node.renderable.group);
      node.renderable.dispose();
      node.children?.forEach(visit);
    };
    this.roots.forEach(visit);
    this.roots.length = 0;
  }
}