export type GradedRiver = {
  heights: number[];
  reversed: boolean;
};

export function gradeRiverProfile(
  sampledTerrain: number[],
  minimumDropMeters = 0.05,
  surfaceClearanceMeters = 0.35,
  orientByEndpointElevation = true,
): GradedRiver {
  if (sampledTerrain.length < 2) {
    return {
      heights: sampledTerrain.map((value) => value + surfaceClearanceMeters),
      reversed: false,
    };
  }

  const reversed =
    orientByEndpointElevation &&
    sampledTerrain[0] < sampledTerrain[sampledTerrain.length - 1];
  const terrain = reversed
    ? [...sampledTerrain].reverse()
    : [...sampledTerrain];
  const heights = terrain.map((value) => value + surfaceClearanceMeters);

  for (let index = heights.length - 2; index >= 0; index -= 1) {
    heights[index] = Math.max(
      heights[index],
      heights[index + 1] + minimumDropMeters,
    );
  }

  return { heights, reversed };
}

export type WaterOwner = 'none' | 'ocean' | 'river' | 'standing';

export function resolveWaterOwner({
  isOcean,
  isRiver,
  isStandingWater,
}: {
  isOcean: boolean;
  isRiver: boolean;
  isStandingWater: boolean;
}): WaterOwner {
  if (isStandingWater) return 'standing';
  if (isRiver) return 'river';
  if (isOcean) return 'ocean';
  return 'none';
}