import { describe, expect, it } from 'vitest';
import { fillTerrainBasins } from '../src/lib/hydrology/priority-flood';
import {
  gradeRiverProfile,
  resolveWaterOwner,
} from '../src/lib/hydrology/river-network';
import { rasterizeOwnedRibbonCells } from '../src/lib/water/ribbon-ownership';

describe('priority-flood standing water', () => {
  it('fills a contained positive-elevation basin to its spill level', () => {
    const heights = new Float32Array([
      10, 10, 10, 10, 10,
      10,  4,  4,  4, 10,
      10,  4,  1,  4, 10,
      10,  4,  4,  4, 10,
      10, 10, 10, 10, 10,
    ]);
    const result = fillTerrainBasins(heights, 5, 5, {
      minimumDepth: 0.5,
      minimumCells: 1,
    });

    expect(result.basinCount).toBe(1);
    expect(result.spillLevels[0]).toBe(10);
    expect(result.filledElevation[12]).toBe(10);
    expect(result.waterDepth[12]).toBe(9);
  });

  it('does not classify below-sea terrain as a standing basin', () => {
    const heights = new Float32Array([
      0, 0, 0,
      0, -4, 0,
      0, 0, 0,
    ]);
    const result = fillTerrainBasins(heights, 3, 3, {
      minimumDepth: 0.1,
      minimumCells: 1,
    });
    expect(result.basinCount).toBe(0);
    expect(result.basinId[4]).toBe(-1);
  });
});

describe('centerline river grading and ownership', () => {
  it('creates a strictly downhill profile without cutting below terrain', () => {
    const terrain = [110, 103, 105, 96, 91];
    const result = gradeRiverProfile(terrain, 0.25, 0.35);
    expect(result.reversed).toBe(false);
    for (let index = 0; index < result.heights.length - 1; index += 1) {
      expect(result.heights[index]).toBeGreaterThan(
        result.heights[index + 1],
      );
      expect(result.heights[index]).toBeGreaterThanOrEqual(
        terrain[index] + 0.35,
      );
    }
  });

  it('orients a centerline toward the lower endpoint', () => {
    const result = gradeRiverProfile([3, 7, 12]);
    expect(result.reversed).toBe(true);
    expect(result.heights[0]).toBeGreaterThan(result.heights.at(-1)!);
  });

  it('assigns exactly one deterministic water owner', () => {
    expect(
      resolveWaterOwner({
        isOcean: true,
        isRiver: true,
        isStandingWater: true,
      }),
    ).toBe('standing');
    expect(
      resolveWaterOwner({
        isOcean: true,
        isRiver: true,
        isStandingWater: false,
      }),
    ).toBe('river');
    expect(
      resolveWaterOwner({
        isOcean: true,
        isRiver: false,
        isStandingWater: false,
      }),
    ).toBe('ocean');
  });

  it('clips river ribbons at every ownership cell, including between old samples', () => {
    const cells = rasterizeOwnedRibbonCells(
      { x: 0, y: 12, z: 0 },
      { x: 180, y: 10, z: 0 },
      8,
      {
        originX: 0,
        originZ: -10,
        cellWidth: 10,
        cellHeight: 10,
        width: 18,
        height: 2,
      },
      (cellX) => cellX !== 7,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(
      cells.some((cell) => cell.x < 80 && cell.x + 10 > 70),
    ).toBe(false);
  });

  it('treats an interior foreign-owner cell as authoritative, not sampled', () => {
    const cells = rasterizeOwnedRibbonCells(
      { x: 0, y: 4, z: 0 },
      { x: 30, y: 3, z: 30 },
      6,
      {
        originX: 0,
        originZ: 0,
        cellWidth: 10,
        cellHeight: 10,
        width: 3,
        height: 3,
      },
      (cellX, cellY) => !(cellX === 1 && cellY === 1),
    );
    expect(cells.some((cell) => cell.key === '1:1')).toBe(false);
  });
});