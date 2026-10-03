import type { Ring } from "../types";

export type BBox = { south: number; west: number; north: number; east: number };

export type ComBuildingFootprint = {
  id: string;
  ring: Ring;
  holes: Ring[];
  height_m: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
