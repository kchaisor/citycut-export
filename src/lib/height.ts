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

/** True when the tag names a unit. A bare number stays in metres. */
export function explicitLengthUnit(raw: string | undefined): "mm" | "cm" | "ft" | "m" | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  if (text.includes("ft") || text.includes("'")) return "ft";
  if (text.includes("mm") || text.includes("millimet")) return "mm";
  if (text.includes("cm") || text.includes("centimet")) return "cm";
  if (/\bm\b/.test(text) || text.includes("metre") || text.includes("meter")) return "m";
  return null;
}

/** Parse an OSM length tag. Feet, centimetres, and millimetres are converted; bare numbers are metres. */
export function parseMeters(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = parseLooseNumber(raw);
  if (value === null) return null;
  const unit = explicitLengthUnit(raw);
  if (unit === "ft") return value * 0.3048;
  if (unit === "mm") return value / 1000;
  if (unit === "cm") return value / 100;
  return value;
}

export function clampBuildingHeight(meters: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, meters));
}

export function buildingHeight(tags: Record<string, string>): number {
  const tagged =
    parseMeters(tags.height) ??
    parseMeters(tags["building:height"]) ??
    parseMeters(tags.est_height);
  if (tagged !== null && tagged > 0) return clampBuildingHeight(tagged);

  const levels = parseLooseNumber(tags["building:levels"]);
  if (levels !== null && levels > 0) return clampBuildingHeight(levels * LEVEL_HEIGHT);

  return DEFAULT_HEIGHT;
}
