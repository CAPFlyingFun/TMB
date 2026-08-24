import { describe, expect, it } from 'vitest';
import {
  geographicToWorld,
  snapFloatingOrigin,
  worldToGeographic,
} from '../src/lib/geo/coordinates';

describe('Kauaʻi coordinate frame', () => {
  it('round-trips geographic coordinates without visible drift', () => {
    const locations = [
      [-159.3711, 21.9811],
      [-159.6586, 22.0594],
      [-159.6456, 22.1742],
      [-159.4977, 22.0733],
    ] as const;

    for (const [longitude, latitude] of locations) {
      const world = geographicToWorld(longitude, latitude);
      const geographic = worldToGeographic(world.x, world.z);
      expect(geographic.longitude).toBeCloseTo(longitude, 10);
      expect(geographic.latitude).toBeCloseTo(latitude, 10);
    }
  });

  it('snaps floating-origin rebases to stable five-kilometer increments', () => {
    expect(snapFloatingOrigin(12_300)).toBe(10_000);
    expect(snapFloatingOrigin(-12_900)).toBe(-15_000);
    expect(snapFloatingOrigin(2_499)).toBe(0);
    expect(snapFloatingOrigin(2_501)).toBe(5_000);
  });
});