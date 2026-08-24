import * as THREE from 'three';

export type OceanMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uTime: { value: number };
    uOwnershipDiagnostic: { value: number };
  };
};

export function createOceanMaterial(): OceanMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uOwnershipDiagnostic: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      attribute float aDepth;
      varying float vDepth;
      varying vec3 vWorldPosition;
      varying vec3 vNormal;
      varying float vWave;

      void main() {
        vec3 displaced = position;
        float broad = sin((position.x + uTime * 15.0) * 0.0018)
          * cos((position.z - uTime * 11.0) * 0.0021);
        float chop = sin((position.x + position.z + uTime * 32.0) * 0.007);
        float wave = broad * 0.85 + chop * 0.18;
        displaced.y += wave;
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vWorldPosition = world.xyz;
        vNormal = normalize(normalMatrix * normal);
        vDepth = aDepth;
        vWave = wave;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uOwnershipDiagnostic;
      varying float vDepth;
      varying vec3 vWorldPosition;
      varying vec3 vNormal;
      varying float vWave;

      void main() {
        vec3 shallow = vec3(0.07, 0.46, 0.48);
        vec3 shelf = vec3(0.025, 0.22, 0.33);
        vec3 deep = vec3(0.006, 0.055, 0.12);
        float shelfMix = smoothstep(4.0, 70.0, vDepth);
        float deepMix = smoothstep(90.0, 900.0, vDepth);
        vec3 water = mix(shallow, shelf, shelfMix);
        water = mix(water, deep, deepMix);

        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(viewDirection, vNormal), 0.0), 3.0);
        vec3 reflectedSky = vec3(0.34, 0.58, 0.72);
        water = mix(water, reflectedSky, fresnel * 0.62);
        water += max(vWave, 0.0) * 0.025;

        if (uOwnershipDiagnostic > 0.5) {
          water = vec3(0.04, 0.38, 0.95);
        }
        gl_FragColor = vec4(water, 0.91);
      }
    `,
  }) as OceanMaterial;
}

export function createStandingWaterMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1aa8b6,
    roughness: 0.16,
    metalness: 0.08,
    transmission: 0.05,
    transparent: true,
    opacity: 0.9,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

export function createRiverMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1b9fb9,
    roughness: 0.2,
    metalness: 0.06,
    transparent: false,
    side: THREE.DoubleSide,
  });
}