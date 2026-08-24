export type RibbonPoint = {
  x: number;
  y: number;
  z: number;
};

export type OwnedRibbonCell = {
  key: string;
  x: number;
  z: number;
  width: number;
  height: number;
  heights: [number, number, number, number];
};

export type OwnershipGrid = {
  originX: number;
  originZ: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
};

type Point2 = {
  x: number;
  z: number;
};

function clipAgainstBoundary(
  polygon: Point2[],
  inside: (point: Point2) => boolean,
  intersect: (start: Point2, end: Point2) => Point2,
) {
  const output: Point2[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const startInside = inside(start);
    const endInside = inside(end);
    if (startInside && endInside) output.push(end);
    else if (startInside) output.push(intersect(start, end));
    else if (endInside) {
      output.push(intersect(start, end));
      output.push(end);
    }
  }
  return output;
}

function ribbonIntersectsCell(
  ribbon: Point2[],
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
) {
  let polygon = ribbon;
  const verticalIntersection =
    (boundary: number) => (start: Point2, end: Point2) => {
      const t = (boundary - start.x) / (end.x - start.x);
      return { x: boundary, z: start.z + (end.z - start.z) * t };
    };
  const horizontalIntersection =
    (boundary: number) => (start: Point2, end: Point2) => {
      const t = (boundary - start.z) / (end.z - start.z);
      return { x: start.x + (end.x - start.x) * t, z: boundary };
    };
  polygon = clipAgainstBoundary(
    polygon,
    (point) => point.x >= minX,
    verticalIntersection(minX),
  );
  if (polygon.length === 0) return false;
  polygon = clipAgainstBoundary(
    polygon,
    (point) => point.x <= maxX,
    verticalIntersection(maxX),
  );
  if (polygon.length === 0) return false;
  polygon = clipAgainstBoundary(
    polygon,
    (point) => point.z >= minZ,
    horizontalIntersection(minZ),
  );
  if (polygon.length === 0) return false;
  polygon = clipAgainstBoundary(
    polygon,
    (point) => point.z <= maxZ,
    horizontalIntersection(maxZ),
  );
  return polygon.length >= 3;
}

export function rasterizeOwnedRibbonCells(
  start: RibbonPoint,
  end: RibbonPoint,
  width: number,
  grid: OwnershipGrid,
  isCellOwned: (cellX: number, cellY: number) => boolean,
) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 0.01) return [];
  const length = Math.sqrt(lengthSquared);
  const offsetX = (-dz / length) * width * 0.5;
  const offsetZ = (dx / length) * width * 0.5;
  const ribbon = [
    { x: start.x + offsetX, z: start.z + offsetZ },
    { x: end.x + offsetX, z: end.z + offsetZ },
    { x: end.x - offsetX, z: end.z - offsetZ },
    { x: start.x - offsetX, z: start.z - offsetZ },
  ];
  const minX = Math.min(...ribbon.map((point) => point.x));
  const maxX = Math.max(...ribbon.map((point) => point.x));
  const minZ = Math.min(...ribbon.map((point) => point.z));
  const maxZ = Math.max(...ribbon.map((point) => point.z));
  const firstCellX = Math.floor((minX - grid.originX) / grid.cellWidth);
  const lastCellX = Math.floor((maxX - grid.originX) / grid.cellWidth);
  const firstCellZ = Math.floor((minZ - grid.originZ) / grid.cellHeight);
  const lastCellZ = Math.floor((maxZ - grid.originZ) / grid.cellHeight);
  const cells: OwnedRibbonCell[] = [];

  for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ += 1) {
    for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
      if (!isCellOwned(cellX, cellZ)) continue;
      const x = grid.originX + cellX * grid.cellWidth;
      const z = grid.originZ + cellZ * grid.cellHeight;
      if (
        !ribbonIntersectsCell(
          ribbon,
          x,
          z,
          x + grid.cellWidth,
          z + grid.cellHeight,
        )
      ) {
        continue;
      }
      const projectHeight = (pointX: number, pointZ: number) => {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((pointX - start.x) * dx + (pointZ - start.z) * dz) /
              lengthSquared,
          ),
        );
        return start.y + (end.y - start.y) * t;
      };
      cells.push({
        key: `${cellX}:${cellZ}`,
        x,
        z,
        heights: [
          projectHeight(x, z),
          projectHeight(x + grid.cellWidth, z),
          projectHeight(x, z + grid.cellHeight),
          projectHeight(x + grid.cellWidth, z + grid.cellHeight),
        ],
        width: grid.cellWidth,
        height: grid.cellHeight,
      });
    }
  }
  return cells;
}