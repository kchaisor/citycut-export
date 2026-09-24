import { parseMeters } from "./height";

/** Typical Melbourne street tree when OSM has no size tags. */
export const DEFAULT_TREE_HEIGHT = 10;
export const DEFAULT_CROWN_DIAMETER = 6;

const MIN_HEIGHT = 2;
const MAX_HEIGHT = 50;
const MIN_CROWN = 1.5;
const MAX_CROWN = 36;
const CROWN_PER_HEIGHT = DEFAULT_CROWN_DIAMETER / DEFAULT_TREE_HEIGHT;

const CROWN_KEYS = ["diameter_crown", "crown_diameter", "diameter:crown"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function firstMeters(tags: Record<string, string>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = parseMeters(tags[key]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

export type TreeSize = {
  height: number;
  crownDiameter: number;
};

/** Height and crown diameter from OSM tags, otherwise a Melbourne street-tree default. */
export function treeSize(tags: Record<string, string>): TreeSize {
  const taggedHeight = firstMeters(tags, ["height"]);
  const taggedCrown = firstMeters(tags, CROWN_KEYS);
  if (taggedHeight === null && taggedCrown === null) {
    return { height: DEFAULT_TREE_HEIGHT, crownDiameter: DEFAULT_CROWN_DIAMETER };
  }

  const height = taggedHeight ?? (taggedCrown as number) / CROWN_PER_HEIGHT;
  const crown = taggedCrown ?? height * CROWN_PER_HEIGHT;
  return {
    height: clamp(height, MIN_HEIGHT, MAX_HEIGHT),
    crownDiameter: clamp(crown, MIN_CROWN, MAX_CROWN),
  };
}
