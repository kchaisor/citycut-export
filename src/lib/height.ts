const MIN_HEIGHT = 3;
const MAX_HEIGHT = 420;
const DEFAULT_HEIGHT = 9;
const LEVEL_HEIGHT = 3;

export function parseLooseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.trim().replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** Parse an OSM height tag. Feet are converted; bare numbers are meters. */
export function parseMeters(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  const value = parseLooseNumber(text);
  if (value === null) return null;
  if (text.includes("ft") || text.includes("'")) return value * 0.3048;
  return value;
}

function clampHeight(meters: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, meters));
}

export function buildingHeight(tags: Record<string, string>): number {
  const tagged =
    parseMeters(tags.height) ??
    parseMeters(tags["building:height"]) ??
    parseMeters(tags.est_height);
  if (tagged !== null && tagged > 0) return clampHeight(tagged);

  const levels = parseLooseNumber(tags["building:levels"]);
  if (levels !== null && levels > 0) return clampHeight(levels * LEVEL_HEIGHT);

  return DEFAULT_HEIGHT;
}
