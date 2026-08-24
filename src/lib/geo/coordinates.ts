export const KAUAI_REFERENCE = {
  latitude: 22.05,
  longitude: -159.55,
} as const;

const METERS_PER_DEGREE_LATITUDE = 110_574;
const METERS_PER_DEGREE_LONGITUDE =
  111_320 * Math.cos((KAUAI_REFERENCE.latitude * Math.PI) / 180);

export type GeographicPoint = {
  latitude: number;
  longitude: number;
};

export type WorldPoint = {
  x: number;
  z: number;
};

export function geographicToWorld(
  longitude: number,
  latitude: number,
): WorldPoint {
  return {
    x: (longitude - KAUAI_REFERENCE.longitude) * METERS_PER_DEGREE_LONGITUDE,
    z: -(latitude - KAUAI_REFERENCE.latitude) * METERS_PER_DEGREE_LATITUDE,
  };
}

export function worldToGeographic(x: number, z: number): GeographicPoint {
  return {
    longitude: KAUAI_REFERENCE.longitude + x / METERS_PER_DEGREE_LONGITUDE,
    latitude: KAUAI_REFERENCE.latitude - z / METERS_PER_DEGREE_LATITUDE,
  };
}

export function geographicDistanceMeters(
  a: GeographicPoint,
  b: GeographicPoint,
): number {
  const aw = geographicToWorld(a.longitude, a.latitude);
  const bw = geographicToWorld(b.longitude, b.latitude);
  return Math.hypot(aw.x - bw.x, aw.z - bw.z);
}

export function snapFloatingOrigin(value: number, increment = 5_000): number {
  return Math.round(value / increment) * increment;
}