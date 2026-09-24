import map from "./treeMap.json";
import { GENERIC_ARCHETYPE } from "./treeForms";

/**
 * OSM names are matched case-insensitively. Spaces and underscores are the same,
 * a hybrid × is ignored, and a genus fallback is tried before leaf tags and the
 * generic form. Keys in treeMap.json are already in that normalized form.
 */
const SKIP = new Set(["x", "subsp", "ssp", "var", "cv", "cf"]);

export type TreeIdentity = {
  genus?: string;
  species?: string;
  taxon?: string;
  leafType?: string;
  leafCycle?: string;
};

export function normalizeTaxon(value: string | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/×/g, " x ")
    .replace(/[_./-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | undefined): string[] {
  return normalizeTaxon(value)
    .split(" ")
    .filter((part) => part && !SKIP.has(part));
}

function speciesHit(value: string | undefined): string | undefined {
  const parts = tokens(value);
  if (parts.length === 0) return undefined;
  const full = parts.join(" ");
  const table = map.species as Record<string, string>;
  if (table[full]) return table[full];
  if (parts.length >= 2) {
    const binomial = `${parts[0]} ${parts[1]}`;
    if (table[binomial]) return table[binomial];
  }
  return undefined;
}

function genusHit(value: string | undefined): string | undefined {
  const [genus] = tokens(value);
  if (!genus) return undefined;
  return (map.genus as Record<string, string>)[genus];
}

function named(tags: TreeIdentity): string[] {
  const names = [tags.species, tags.taxon];
  const genus = tokens(tags.genus)[0];
  const species = tokens(tags.species);
  if (genus && species.length > 0 && species[0] !== genus) names.push(`${genus} ${species.join(" ")}`);
  return names.filter((name): name is string => Boolean(name));
}

/** Archetype id for an OSM tree. Unknown names use the generic form. */
export function resolveArchetype(tags: TreeIdentity): string {
  const names = named(tags);
  for (const name of names) {
    const hit = speciesHit(name);
    if (hit) return hit;
  }
  for (const name of [tags.genus, ...names]) {
    const hit = genusHit(name);
    if (hit) return hit;
  }
  const leafType = normalizeTaxon(tags.leafType);
  const typeHit = (map.leafType as Record<string, string>)[leafType];
  if (typeHit) return typeHit;
  const leafCycle = normalizeTaxon(tags.leafCycle);
  const cycleHit = (map.leafCycle as Record<string, string>)[leafCycle];
  if (cycleHit) return cycleHit;
  return GENERIC_ARCHETYPE;
}

export function mappedArchetypeIds(): string[] {
  return [...Object.values(map.species), ...Object.values(map.genus), ...Object.values(map.leafType), ...Object.values(map.leafCycle)];
}
