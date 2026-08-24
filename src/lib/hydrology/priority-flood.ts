export type PriorityFloodOptions = {
  noDataValue?: number;
  minimumDepth?: number;
  minimumCells?: number;
};

export type BasinFillResult = {
  filledElevation: Float32Array;
  waterDepth: Float32Array;
  basinId: Int32Array;
  basinCount: number;
  spillLevels: number[];
};

type QueueEntry = {
  index: number;
  elevation: number;
};

class MinHeap {
  private values: QueueEntry[] = [];

  get size() {
    return this.values.length;
  }

  push(entry: QueueEntry) {
    this.values.push(entry);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].elevation <= entry.elevation) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = entry;
  }

  pop(): QueueEntry | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child =
        right < this.values.length &&
        this.values[right].elevation < this.values[left].elevation
          ? right
          : left;
      if (this.values[child].elevation >= last.elevation) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function isNoData(value: number, noDataValue?: number) {
  return !Number.isFinite(value) || value === noDataValue;
}

export function fillTerrainBasins(
  heights: Float32Array,
  width: number,
  height: number,
  options: PriorityFloodOptions = {},
): BasinFillResult {
  if (heights.length !== width * height) {
    throw new Error('Height grid dimensions do not match the supplied data.');
  }

  const minimumDepth = options.minimumDepth ?? 0.75;
  const minimumCells = options.minimumCells ?? 6;
  const filledElevation = new Float32Array(heights);
  const waterDepth = new Float32Array(heights.length);
  const visited = new Uint8Array(heights.length);
  const queue = new MinHeap();

  const seed = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    const elevation = heights[index];
    if (!isNoData(elevation, options.noDataValue)) {
      queue.push({ index, elevation });
    }
  };

  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;

  while (queue.size > 0) {
    const current = queue.pop();
    if (!current) break;
    const x = current.index % width;
    const y = Math.floor(current.index / width);

    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nextIndex = ny * width + nx;
      if (visited[nextIndex]) continue;
      visited[nextIndex] = 1;
      const nextElevation = heights[nextIndex];
      if (isNoData(nextElevation, options.noDataValue)) continue;
      const filled = Math.max(nextElevation, current.elevation);
      filledElevation[nextIndex] = filled;
      waterDepth[nextIndex] = Math.max(0, filled - nextElevation);
      queue.push({ index: nextIndex, elevation: filled });
    }
  }

  const basinId = new Int32Array(heights.length);
  basinId.fill(-1);
  const spillLevels: number[] = [];
  let basinCount = 0;

  for (let start = 0; start < heights.length; start += 1) {
    if (
      basinId[start] !== -1 ||
      waterDepth[start] < minimumDepth ||
      heights[start] <= 0
    ) {
      continue;
    }

    const component: number[] = [];
    const pending = [start];
    basinId[start] = -2;
    let spillLevel = -Infinity;

    while (pending.length > 0) {
      const index = pending.pop()!;
      component.push(index);
      spillLevel = Math.max(spillLevel, filledElevation[index]);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nextIndex = ny * width + nx;
        if (
          basinId[nextIndex] === -1 &&
          waterDepth[nextIndex] >= minimumDepth &&
          heights[nextIndex] > 0
        ) {
          basinId[nextIndex] = -2;
          pending.push(nextIndex);
        }
      }
    }

    if (component.length < minimumCells) {
      for (const index of component) {
        basinId[index] = -3;
        waterDepth[index] = 0;
      }
      continue;
    }

    for (const index of component) {
      basinId[index] = basinCount;
      filledElevation[index] = spillLevel;
      waterDepth[index] = Math.max(0, spillLevel - heights[index]);
    }
    spillLevels.push(spillLevel);
    basinCount += 1;
  }

  return {
    filledElevation,
    waterDepth,
    basinId,
    basinCount,
    spillLevels,
  };
}