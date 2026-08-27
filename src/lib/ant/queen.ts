/**
 * THE QUEEN, DROPPED INTO A MAP THAT WAS NEVER BUILT FOR HER.
 *
 * TMB is a terrain viewer: one metre is one unit, the camera was
 * clamped 35 m off the ground, and the finest terrain vertex is metres
 * apart. This module puts a real fire-ant queen on that ground at her
 * real size so the mismatch can be LOOKED at rather than argued about.
 *
 * SCALE IS MEASURED, NOT TYPED — the same rule the game uses. The
 * model's own units mean nothing, so her body mesh is measured on load
 * and scaled until it matches the length asked for. Her wings reach far
 * wider than she is long, so measuring the whole object would size her
 * WINGSPAN to a body length and leave her two thirds too small while
 * still looking plausible. The body mesh is measured alone.
 *
 * Lengths here are millimetres in, metres out: 5.5 mm at founding,
 * 11 mm at adult.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const QUEEN_URL = `${import.meta.env.BASE_URL}models/queen-winged.glb`;

/** What the bake calls the two halves. */
const BODY_MESH = 'queen_body';
const WINGS_MESH = 'queen_wings';

/** Her length at founding and at full size, in millimetres. */
export const QUEEN_START_MM = 5.5;
export const QUEEN_ADULT_MM = 11;

/** Longest horizontal side of a box — nose to gaster is the long axis. */
function longestSide(box: THREE.Box3): number {
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.z);
}

export interface Queen {
  readonly model: THREE.Object3D;
  /** Her length in world units, i.e. metres. */
  readonly length: number;
  setWings(on: boolean): void;
  dispose(): void;
}

/**
 * Load her and size her to `lengthMm`, standing on y = 0 in her own
 * local frame so the caller only has to supply the ground height.
 */
export async function loadQueen(lengthMm = QUEEN_START_MM): Promise<Queen> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(QUEEN_URL);
  const model = gltf.scene;

  const body = model.getObjectByName(BODY_MESH) ?? null;
  const wings = model.getObjectByName(WINGS_MESH) ?? null;

  const measured = longestSide(new THREE.Box3().setFromObject(body ?? model));
  if (!(measured > 0)) throw new Error('the queen model measured nothing');

  const wanted = lengthMm / 1000;
  model.scale.setScalar(wanted / measured);

  model.updateMatrixWorld(true);
  const stood = new THREE.Box3().setFromObject(model);
  model.position.y -= stood.min.y;

  // A few millimetres of ant against a 500 km far plane: her bounding
  // sphere is a rounding error, and culling her on it makes her blink.
  model.traverse((part) => { part.frustumCulled = false; });

  return {
    model,
    length: wanted,
    setWings: (on: boolean) => { if (wings) wings.visible = on; },
    dispose: () => {
      model.traverse((part) => {
        const mesh = part as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) for (const m of material) m.dispose();
        else material?.dispose();
      });
    },
  };
}
