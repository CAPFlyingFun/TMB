import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  geographicToWorld,
  snapFloatingOrigin,
  worldToGeographic,
} from '@/lib/geo/coordinates';
import {
  TerrainLodManager,
  type TerrainLodStats,
} from '@/lib/terrain/terrain-lod';
import { createOceanMaterial } from '@/lib/water/water-materials';
import { createRiverNetworkMesh } from '@/lib/water/river-mesh';
import { loadQueen, QUEEN_START_MM, type Queen } from '@/lib/ant/queen';

export interface ViewerState {
  layers: {
    terrain: boolean;
    rivers: boolean;
    standingWater: boolean;
    ocean: boolean;
  };
  diagnostics: {
    tileBoundaries: boolean;
    waterOwnership: boolean;
    spillLevels: boolean;
    wireframe: boolean;
  };
}

export type TelemetryData = {
  lat: number;
  lon: number;
  elevation: number;
  groundElevation: number;
  altitudeAboveGround: number;
  heading: number;
  pitch: number;
};

export type SceneStatus = {
  phase: 'loading' | 'ready' | 'error';
  message: string;
  loadedTiles: number;
  activeTiles: number;
  maximumActiveLevel: number;
  riverFeatures: number;
};

export type TelemetryCallback = (data: TelemetryData) => void;
export type StatusCallback = (status: SceneStatus) => void;

type RiverNetwork = Awaited<ReturnType<typeof createRiverNetworkMesh>>;

export class TerrainScene {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly worldRoot = new THREE.Group();
  private readonly oceanMaterial = createOceanMaterial();
  private readonly terrainLod: TerrainLodManager;
  private readonly keys = new Set<string>();
  private animationFrameId = 0;
  private lastFrame = performance.now();
  private lastLodUpdate = 0;
  private onTelemetry?: TelemetryCallback;
  private onStatus?: StatusCallback;
  private currentState: ViewerState;
  private floatingOrigin = new THREE.Vector3();
  private riverNetwork?: RiverNetwork;
  private riverFeatureCount = 0;
  private riverLodLevel = 0;
  private rebuildingRivers = false;
  private farOceanMeshes: THREE.Mesh[] = [];
  private queen?: Queen;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    initialState: ViewerState,
    onTelemetry?: TelemetryCallback,
    onStatus?: StatusCallback,
  ) {
    this.onTelemetry = onTelemetry;
    this.onStatus = onStatus;
    this.currentState = initialState;

    this.scene.background = new THREE.Color(0x9ac6d5);
    this.scene.fog = new THREE.Fog(0x9ac6d5, 65_000, 230_000);
    this.scene.add(this.worldRoot);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.004, 500_000);
    this.camera.position.set(28_000, 31_000, 38_000);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // A 4 mm near plane against a 500 km far plane is a depth ratio no
      // fixed-point buffer survives. The ant-scale look needs both ends.
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // ANT-SCALE TEST: the viewer is lit for looking DOWN at an island
    // from orbit, where a dark palette reads well. Standing in it, the
    // same palette is nearly black. Lifted so ground level is legible;
    // this changes the LOOK and nothing about where the water is.
    this.renderer.toneMappingExposure = 1.9;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.resize();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    // 35 m was the closest this viewer would let you get. At ant scale
    // that is 3,500 body lengths, so the camera could never stand in
    // the world it was drawing.
    this.controls.minDistance = 0.005;
    this.controls.maxDistance = 190_000;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 450, 0);
    this.controls.update();

    this.setupLights();
    this.terrainLod = new TerrainLodManager(
      this.worldRoot,
      this.oceanMaterial,
      initialState,
      (stats) => this.handleTerrainProgress(stats),
    );

    this.resize = this.resize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.animate = this.animate.bind(this);
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    this.emitStatus('loading', 'Loading NOAA terrain', {
      loadedTiles: 0,
      activeTiles: 0,
      maximumActiveLevel: 0,
    });
    void this.initialize();
    this.animate();
  }

  private async initialize() {
    try {
      const manifest = await this.terrainLod.initialize();
      if (this.disposed) return;
      this.setupFarOcean(manifest.coverageBounds);
      this.terrainLod.applyState(this.currentState);
      this.riverNetwork = await createRiverNetworkMesh(
        this.terrainLod.source,
        (x, z) => this.terrainLod.isStandingWaterAtWorld(x, z),
      );
      if (this.disposed) {
        this.riverNetwork.dispose();
        return;
      }
      this.riverFeatureCount = this.riverNetwork.featureCount;
      this.riverLodLevel = this.terrainLod.getStats().maximumActiveLevel;
      this.riverNetwork.group.visible = this.currentState.layers.rivers;
      this.worldRoot.add(this.riverNetwork.group);
      this.emitStatus(
        'ready',
        'NOAA terrain and NHD waterways online',
        this.terrainLod.getStats(),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Terrain initialization failed.';
      this.emitStatus('error', message, this.terrainLod.getStats());
      console.error(error);
    }
  }

  private handleTerrainProgress(stats: TerrainLodStats) {
    const ready = Boolean(this.riverNetwork);
    this.emitStatus(
      ready ? 'ready' : 'loading',
      ready ? 'Terrain detail refined' : 'Refining terrain tiles',
      stats,
    );
    if (
      ready &&
      stats.maximumActiveLevel > this.riverLodLevel &&
      !this.rebuildingRivers
    ) {
      void this.rebuildRiverOwnership(stats.maximumActiveLevel);
    }
  }

  private async rebuildRiverOwnership(level: number) {
    this.rebuildingRivers = true;
    try {
      const replacement = await createRiverNetworkMesh(
        this.terrainLod.source,
        (x, z) => this.terrainLod.isStandingWaterAtWorld(x, z),
      );
      if (this.disposed) {
        replacement.dispose();
        return;
      }
      const previous = this.riverNetwork;
      replacement.group.visible = this.currentState.layers.rivers;
      replacement.water.material.color.setHex(
        this.currentState.diagnostics.waterOwnership ? 0xf1a124 : 0x1b9fb9,
      );
      this.worldRoot.add(replacement.group);
      if (previous) {
        this.worldRoot.remove(previous.group);
        previous.dispose();
      }
      this.riverNetwork = replacement;
      this.riverFeatureCount = replacement.featureCount;
      this.riverLodLevel = level;
      this.emitStatus(
        'ready',
        'Water ownership synchronized',
        this.terrainLod.getStats(),
      );
    } catch (error) {
      console.error('River ownership rebuild failed', error);
    } finally {
      this.rebuildingRivers = false;
    }
  }

  private setupLights() {
    const hemisphere = new THREE.HemisphereLight(0xd6f0ff, 0x25311f, 1.8);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff2d0, 3.1);
    sun.position.set(-35_000, 55_000, 18_000);
    this.scene.add(sun);
    // A little fill, so a slope facing away from that sun is still a
    // slope rather than a silhouette.
    this.scene.add(new THREE.AmbientLight(0xbfd8e6, 0.9));
  }

  private setupFarOcean(
    coverageBounds: [number, number, number, number],
  ) {
    const [minLon, minLat, maxLon, maxLat] = coverageBounds;
    const west = geographicToWorld(minLon, (minLat + maxLat) * 0.5).x;
    const east = geographicToWorld(maxLon, (minLat + maxLat) * 0.5).x;
    const north = geographicToWorld((minLon + maxLon) * 0.5, maxLat).z;
    const south = geographicToWorld((minLon + maxLon) * 0.5, minLat).z;
    const outer = 260_000;

    const addStrip = (
      minX: number,
      maxX: number,
      minZ: number,
      maxZ: number,
    ) => {
      const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 24, 24);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      const depths = new Float32Array(
        geometry.getAttribute('position').count,
      ).fill(1_500);
      geometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
      const mesh = new THREE.Mesh(geometry, this.oceanMaterial);
      mesh.position.y = 0.1;
      mesh.userData.farOcean = true;
      this.farOceanMeshes.push(mesh);
      this.worldRoot.add(mesh);
    };

    addStrip(-outer, west, -outer, outer);
    addStrip(east, outer, -outer, outer);
    addStrip(west, east, -outer, north);
    addStrip(west, east, south, outer);
  }

  public updateState(newState: ViewerState) {
    this.currentState = newState;
    this.terrainLod.applyState(newState);
    if (this.riverNetwork) {
      this.riverNetwork.group.visible = newState.layers.rivers;
      this.riverNetwork.water.material.color.setHex(
        newState.diagnostics.waterOwnership ? 0xf1a124 : 0x1b9fb9,
      );
    }
    for (const mesh of this.farOceanMeshes) {
      mesh.visible = newState.layers.ocean;
    }
  }

  /** Stand the camera a given height above the ground, looking level. */
  public standAt(lat: number, lon: number, agl: number, heading = 0) {
    const target = geographicToWorld(lon, lat);
    const ground = this.terrainLod.source.sampleHeightAtWorld(target.x, target.z);
    const localX = target.x - this.floatingOrigin.x;
    const localZ = target.z - this.floatingOrigin.z;
    const rad = (heading * Math.PI) / 180;
    // The look-at point rides OUT with height, or the camera pitches
    // steeply down the moment it climbs: a fixed 40 m target at 300 m
    // up is a 72-degree dive, which photographs the ground under the
    // lens rather than the valley.
    // The target rides out with height, and comes right in at ant
    // scale so OrbitControls' own minimum cannot hold the camera off.
    const out = Math.max(agl * 6, agl < 1 ? 0.05 : 15);
    this.camera.position.set(localX, ground + agl, localZ);
    this.controls.target.set(
      localX + Math.sin(rad) * out,
      ground + agl * 0.35,
      localZ - Math.cos(rad) * out,
    );
    this.controls.update();
    this.lastLodUpdate = 0;
  }

  /**
   * Stand the queen on the ground at a coordinate, at her real size.
   *
   * She joins `worldRoot` in absolute world metres, like the terrain,
   * so the floating origin carries her with everything else. Returns
   * her length in metres and the ground she is standing on.
   */
  public async placeQueen(
    lat: number,
    lon: number,
    lengthMm = QUEEN_START_MM,
  ): Promise<{ length: number; ground: number }> {
    const target = geographicToWorld(lon, lat);
    const ground = this.terrainLod.source.sampleHeightAtWorld(target.x, target.z);
    if (this.queen) {
      this.worldRoot.remove(this.queen.model);
      this.queen.dispose();
      this.queen = undefined;
    }
    const queen = await loadQueen(lengthMm);
    if (this.disposed) {
      queen.dispose();
      return { length: queen.length, ground };
    }
    queen.model.position.set(target.x, ground + queen.model.position.y, target.z);
    this.worldRoot.add(queen.model);
    this.queen = queen;
    return { length: queen.length, ground };
  }

  /** Stand the camera behind the queen, looking at her. */
  public watchQueen(lat: number, lon: number, back: number, heading = 0) {
    const target = geographicToWorld(lon, lat);
    const ground = this.terrainLod.source.sampleHeightAtWorld(target.x, target.z);
    const localX = target.x - this.floatingOrigin.x;
    const localZ = target.z - this.floatingOrigin.z;
    const rad = (heading * Math.PI) / 180;
    const size = this.queen?.length ?? 0.006;
    this.camera.position.set(
      localX - Math.sin(rad) * back,
      ground + size * 0.9,
      localZ + Math.cos(rad) * back,
    );
    this.controls.target.set(localX, ground + size * 0.4, localZ);
    this.controls.update();
    this.lastLodUpdate = 0;
  }

  public jumpTo(lat: number, lon: number, requestedAltitude: number) {
    const target = geographicToWorld(lon, lat);
    const ground = this.terrainLod.source.sampleHeightAtWorld(target.x, target.z);
    const altitude = Math.max(requestedAltitude, 0.004);
    const localX = target.x - this.floatingOrigin.x;
    const localZ = target.z - this.floatingOrigin.z;
    this.controls.target.set(localX, ground, localZ);
    this.camera.position.set(
      localX + altitude * 0.72,
      ground + altitude,
      localZ + altitude * 0.88,
    );
    this.controls.update();
    this.lastLodUpdate = 0;
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    this.keys.add(event.code);
  }

  private handleKeyUp(event: KeyboardEvent) {
    this.keys.delete(event.code);
  }

  private updateFreeFlight(deltaSeconds: number) {
    const forwardInput =
      Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const sideInput =
      Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const verticalInput =
      Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
    if (forwardInput === 0 && sideInput === 0 && verticalInput === 0) return;

    const speed =
      Math.max(0.02, Math.min(4_000, this.camera.position.y * 0.35)) *
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1);
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const movement = new THREE.Vector3()
      .addScaledVector(forward, forwardInput)
      .addScaledVector(right, sideInput);
    movement.y = verticalInput;
    if (movement.lengthSq() === 0) return;
    movement.normalize().multiplyScalar(speed * deltaSeconds);
    this.camera.position.add(movement);
    this.controls.target.add(movement);
  }

  private rebaseIfNeeded() {
    if (
      Math.abs(this.camera.position.x) < 12_000 &&
      Math.abs(this.camera.position.z) < 12_000
    ) {
      return;
    }
    const deltaX = snapFloatingOrigin(this.camera.position.x);
    const deltaZ = snapFloatingOrigin(this.camera.position.z);
    this.floatingOrigin.x += deltaX;
    this.floatingOrigin.z += deltaZ;
    this.camera.position.x -= deltaX;
    this.camera.position.z -= deltaZ;
    this.controls.target.x -= deltaX;
    this.controls.target.z -= deltaZ;
    this.worldRoot.position.set(
      -this.floatingOrigin.x,
      0,
      -this.floatingOrigin.z,
    );
  }

  private resize() {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate(now = performance.now()) {
    if (this.disposed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);
    const deltaSeconds = Math.min(0.05, (now - this.lastFrame) / 1_000);
    this.lastFrame = now;
    this.updateFreeFlight(deltaSeconds);
    this.controls.update();
    this.rebaseIfNeeded();
    this.oceanMaterial.uniforms.uTime.value = now / 1_000;

    const globalCamera = new THREE.Vector3(
      this.camera.position.x + this.floatingOrigin.x,
      this.camera.position.y,
      this.camera.position.z + this.floatingOrigin.z,
    );
    if (now - this.lastLodUpdate > 900) {
      this.lastLodUpdate = now;
      this.terrainLod.update(globalCamera, this.currentState);
    }
    this.emitTelemetry(globalCamera);
    this.renderer.render(this.scene, this.camera);
  }

  private emitTelemetry(globalCamera: THREE.Vector3) {
    if (!this.onTelemetry) return;
    const geographic = worldToGeographic(globalCamera.x, globalCamera.z);
    const targetGlobal = new THREE.Vector3(
      this.controls.target.x + this.floatingOrigin.x,
      this.controls.target.y,
      this.controls.target.z + this.floatingOrigin.z,
    );
    const direction = targetGlobal.sub(globalCamera);
    const heading =
      ((Math.atan2(direction.x, -direction.z) * 180) / Math.PI + 360) % 360;
    const pitch =
      (Math.atan2(
        direction.y,
        Math.hypot(direction.x, direction.z),
      ) *
        180) /
      Math.PI;
    const groundElevation = this.terrainLod.source.sampleHeightAtWorld(
      globalCamera.x,
      globalCamera.z,
    );
    this.onTelemetry({
      lat: geographic.latitude,
      lon: geographic.longitude,
      elevation: globalCamera.y,
      groundElevation,
      altitudeAboveGround: globalCamera.y - groundElevation,
      heading,
      pitch,
    });
  }

  private emitStatus(
    phase: SceneStatus['phase'],
    message: string,
    stats: TerrainLodStats,
  ) {
    this.onStatus?.({
      phase,
      message,
      loadedTiles: stats.loadedTiles,
      activeTiles: stats.activeTiles,
      maximumActiveLevel: stats.maximumActiveLevel,
      riverFeatures: this.riverFeatureCount,
    });
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.terrainLod.dispose();
    if (this.queen) {
      this.worldRoot.remove(this.queen.model);
      this.queen.dispose();
      this.queen = undefined;
    }
    if (this.riverNetwork) {
      this.worldRoot.remove(this.riverNetwork.group);
      this.riverNetwork.dispose();
    }
    for (const mesh of this.farOceanMeshes) {
      this.worldRoot.remove(mesh);
      mesh.geometry.dispose();
    }
    this.farOceanMeshes = [];
    this.oceanMaterial.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}