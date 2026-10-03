import * as polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon } from "polygon-clipping";
import RBush from "rbush";
import { openRing, signedArea } from "./geo";
import type { BuildingFeat, Ring } from "../types";
import type { BuildingExtrusionPart as ExtrusionPart } from "../types";
import type { ComBuildingFootprint } from "./comBuildingHeightsTypes";
import { countBuildingsWithComDerivedExtrusion } from "./comBuildingHeightsCount";

export const COM_SLIVER_MIN_M2 = 2;
export const COM_SLIVER_MIN_FRACTION = 0.05;
export const COM_FALLBACK_MIN_FRACTION = 0.2;
export const COM_SINGLE_PART_COVERAGE = 0.8;

type ClipFns = {
  intersection: (geom: Polygon | MultiPolygon, ...more: Array<Polygon | MultiPolygon>) => MultiPolygon;
  difference: (subject: Polygon | MultiPolygon, ...clips: Array<Polygon | MultiPolygon>) => MultiPolygon;
  union: (...geoms: Array<Polygon | MultiPolygon>) => MultiPolygon;
};

function clippingFns(): ClipFns {
  const loaded = polygonClipping as unknown as ClipFns & { default?: ClipFns };
  if (typeof loaded.intersection === "function") return loaded;
  if (loaded.default && typeof loaded.default.intersection === "function") return loaded.default;
  throw new Error("polygon-clipping did not load.");
}

const { intersection, difference, union } = clippingFns();

type IndexedFootprint = ComBuildingFootprint & { i: number };

function closeRingForClip(ring: Ring): [number, number][] {
  const pts = ring.map(([x, y]) => [x, y] as [number, number]);
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  if (Math.hypot(ax - bx, ay - by) > 1e-9) pts.push([ax, ay]);
  return pts;
}

function toClipPolygon(ring: Ring, holes: Ring[]): Polygon {
  return [closeRingForClip(ring), ...holes.map((hole) => closeRingForClip(hole))];
}

function multiPolygonArea(multi: MultiPolygon): number {
  let area = 0;
  for (const poly of multi) {
    if (!poly[0]?.length) continue;
    let a = Math.abs(signedArea(poly[0] as Ring));
    for (const hole of poly.slice(1)) {
      a -= Math.abs(signedArea(hole as Ring));
    }
    area += a;
  }
  return area;
}

export function intersectionAreaM2(a: { ring: Ring; holes: Ring[] }, b: { ring: Ring; holes: Ring[] }): number {
  try {
    const result = intersection(toClipPolygon(a.ring, a.holes), toClipPolygon(b.ring, b.holes));
    return multiPolygonArea(result);
  } catch {
    return 0;
  }
}

function polygonAreaM2(poly: Polygon): number {
  if (!poly[0]?.length) return 0;
  let a = Math.abs(signedArea(poly[0] as Ring));
  for (const hole of poly.slice(1)) {
    a -= Math.abs(signedArea(hole as Ring));
  }
  return Math.max(0, a);
}

function isSliver(area: number, referenceArea: number): boolean {
  return area < COM_SLIVER_MIN_M2 || area < COM_SLIVER_MIN_FRACTION * referenceArea;
}

function partsFromMultiPolygon(
  multi: MultiPolygon,
  height: number,
  referenceArea: number,
  filterSlivers: boolean,
): ExtrusionPart[] {
  const parts: ExtrusionPart[] = [];
  for (const poly of multi) {
    const area = polygonAreaM2(poly);
    if (filterSlivers && isSliver(area, referenceArea)) continue;
    if (!poly[0]?.length) continue;
    parts.push({
      ring: openRing(poly[0] as Ring),
      holes: poly.slice(1).map((hole) => openRing(hole as Ring)),
      height,
    });
  }
  return parts;
}

function osmClipPolygon(building: BuildingFeat): Polygon {
  return toClipPolygon(building.ring, building.holes);
}

export function pickComHeightFallback20(
  building: BuildingFeat,
  footprints: ComBuildingFootprint[],
): ComBuildingFootprint | null {
  const osmArea = Math.abs(signedArea(openRing(building.ring)));
  if (osmArea <= 0) return null;
  let best: ComBuildingFootprint | null = null;
  let bestHeight = 0;
  for (const footprint of footprints) {
    const overlap = intersectionAreaM2(building, footprint);
    if (overlap <= 0) continue;
    const comArea = Math.abs(signedArea(openRing(footprint.ring)));
    const osmShare = overlap / osmArea;
    const comShare = comArea > 0 ? overlap / comArea : 0;
    if (osmShare < COM_FALLBACK_MIN_FRACTION && comShare < COM_FALLBACK_MIN_FRACTION) continue;
    if (footprint.height_m > bestHeight) {
      bestHeight = footprint.height_m;
      best = footprint;
    }
  }
  return best;
}

function clipBuildingComExtrusions(
  building: BuildingFeat,
  footprints: ComBuildingFootprint[],
): ExtrusionPart[] | null {
  const osmArea = Math.abs(signedArea(openRing(building.ring)));
  if (osmArea <= 0 || footprints.length === 0) return null;

  try {
    const osmPoly = osmClipPolygon(building);
    const comParts: ExtrusionPart[] = [];
    const comUnionInputs: Polygon[] = [];

    for (const footprint of footprints) {
      const inter = intersection(osmPoly, toClipPolygon(footprint.ring, footprint.holes));
      const area = multiPolygonArea(inter);
      if (area <= 0) continue;
      for (const poly of inter) {
        if (!poly[0]?.length) continue;
        comUnionInputs.push(poly as Polygon);
      }
      comParts.push(...partsFromMultiPolygon(inter, footprint.height_m, osmArea, true));
    }

    if (comParts.length === 0) return null;

    let remainderParts: ExtrusionPart[] = [];
    if (comUnionInputs.length > 0) {
      const covered = comUnionInputs.length === 1 ? comUnionInputs[0] : union(...comUnionInputs);
      const remainder = difference(osmPoly, covered);
      remainderParts = partsFromMultiPolygon(remainder, building.height, osmArea, true);
    }

    return [...comParts, ...remainderParts];
  } catch {
    const fallback = pickComHeightFallback20(building, footprints);
    if (!fallback) return null;
    return [{ ring: building.ring, holes: building.holes, height: fallback.height_m }];
  }
}

export function ringBBox(ring: Ring): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function attachFootprintBBox(
  id: string,
  ring: Ring,
  holes: Ring[],
  height_m: number,
): ComBuildingFootprint {
  const { minX, minY, maxX, maxY } = ringBBox(ring);
  return { id, ring, holes, height_m, minX, minY, maxX, maxY };
}

function buildFootprintIndex(footprints: ComBuildingFootprint[]): RBush<IndexedFootprint> {
  const tree = new RBush<IndexedFootprint>();
  tree.load(
    footprints.map((footprint, i) => ({
      ...footprint,
      i,
    })),
  );
  return tree;
}

type OverlapHit = { footprint: ComBuildingFootprint; area: number };

function significantOverlaps(building: BuildingFeat, index: RBush<IndexedFootprint>, osmArea: number): OverlapHit[] {
  const { minX, minY, maxX, maxY } = ringBBox(building.ring);
  const candidates = index.search({ minX, minY, maxX, maxY });
  const hits: OverlapHit[] = [];
  for (const candidate of candidates) {
    const area = intersectionAreaM2(building, candidate);
    if (area <= 0 || isSliver(area, osmArea)) continue;
    hits.push({ footprint: candidate, area });
  }
  hits.sort(
    (a, b) =>
      a.footprint.id.localeCompare(b.footprint.id) ||
      b.area - a.area ||
      a.footprint.minX - b.footprint.minX,
  );
  return hits;
}

function comPartAreaM2(footprint: ComBuildingFootprint): number {
  return Math.abs(signedArea(openRing(footprint.ring)));
}

function singlePartFastPathEligible(hit: OverlapHit, osmArea: number): boolean {
  const osmShare = hit.area / osmArea;
  if (osmShare < COM_SINGLE_PART_COVERAGE) return false;
  const comArea = comPartAreaM2(hit.footprint);
  if (comArea <= 0) return false;
  const comShare = hit.area / comArea;
  return comShare >= COM_SINGLE_PART_COVERAGE;
}

function singlePartLegacyOsmOnlyFastPathEligible(hit: OverlapHit, osmArea: number): boolean {
  return hit.area / osmArea >= COM_SINGLE_PART_COVERAGE;
}

function applyComBuildingHeightsCore(
  buildings: BuildingFeat[],
  footprints: ComBuildingFootprint[],
  options: { allowFastPath: boolean },
): { buildings: BuildingFeat[]; updated: number } {
  if (footprints.length === 0) return { buildings, updated: 0 };
  const index = buildFootprintIndex(footprints);
  const out = buildings.map((building) => {
    const osmArea = Math.abs(signedArea(openRing(building.ring)));
    if (osmArea <= 0) return building;
    const overlaps = significantOverlaps(building, index, osmArea);
    if (overlaps.length === 0) return building;

    if (
      options.allowFastPath &&
      overlaps.length === 1 &&
      singlePartFastPathEligible(overlaps[0], osmArea)
    ) {
      const height = overlaps[0].footprint.height_m;
      if (Math.abs(height - building.height) < 0.05) return building;
      return { ...building, height };
    }

    const candidates = overlaps.map((hit) => hit.footprint);
    const parts = clipBuildingComExtrusions(building, candidates);
    if (!parts || parts.length === 0) return building;
    return { ...building, extrusionParts: parts };
  });
  const updated = countBuildingsWithComDerivedExtrusion(buildings, out);
  return { buildings: out, updated };
}

/** @internal d835ce1 fast path (OSM coverage only) for regression diffs. */
export function applyComBuildingHeightsLegacyOsmOnlyFastPath(
  buildings: BuildingFeat[],
  footprints: ComBuildingFootprint[],
): { buildings: BuildingFeat[]; updated: number } {
  if (footprints.length === 0) return { buildings, updated: 0 };
  const index = buildFootprintIndex(footprints);
  const out = buildings.map((building) => {
    const osmArea = Math.abs(signedArea(openRing(building.ring)));
    if (osmArea <= 0) return building;
    const overlaps = significantOverlaps(building, index, osmArea);
    if (overlaps.length === 0) return building;
    if (
      overlaps.length === 1 &&
      singlePartLegacyOsmOnlyFastPathEligible(overlaps[0], osmArea)
    ) {
      const height = overlaps[0].footprint.height_m;
      if (Math.abs(height - building.height) < 0.05) return building;
      return { ...building, height };
    }
    const candidates = overlaps.map((hit) => hit.footprint);
    const parts = clipBuildingComExtrusions(building, candidates);
    if (!parts || parts.length === 0) return building;
    return { ...building, extrusionParts: parts };
  });
  const updated = countBuildingsWithComDerivedExtrusion(buildings, out);
  return { buildings: out, updated };
}

/** Clip-only matching (0a8b37a behaviour): always intersect, never whole-footprint fast path. */
export function applyComBuildingHeightsClipOnly(
  buildings: BuildingFeat[],
  footprints: ComBuildingFootprint[],
): { buildings: BuildingFeat[]; updated: number } {
  return applyComBuildingHeightsCore(buildings, footprints, { allowFastPath: false });
}

export type ComHeightPathDetail = {
  path: "none" | "fast" | "clip";
  comPartIds: string[];
  osmCoveragePct: number | null;
  comCoveragePct: number | null;
};

function classifyWithEligible(
  building: BuildingFeat,
  footprints: ComBuildingFootprint[],
  eligible: (hit: OverlapHit, osmArea: number) => boolean,
): ComHeightPathDetail {
  if (footprints.length === 0) {
    return { path: "none", comPartIds: [], osmCoveragePct: null, comCoveragePct: null };
  }
  const index = buildFootprintIndex(footprints);
  const osmArea = Math.abs(signedArea(openRing(building.ring)));
  if (osmArea <= 0) {
    return { path: "none", comPartIds: [], osmCoveragePct: null, comCoveragePct: null };
  }
  const overlaps = significantOverlaps(building, index, osmArea);
  if (overlaps.length === 0) {
    return { path: "none", comPartIds: [], osmCoveragePct: null, comCoveragePct: null };
  }
  if (overlaps.length === 1 && eligible(overlaps[0], osmArea)) {
    const hit = overlaps[0];
    const comArea = comPartAreaM2(hit.footprint);
    return {
      path: "fast",
      comPartIds: [hit.footprint.id],
      osmCoveragePct: Math.round((1000 * hit.area) / osmArea) / 10,
      comCoveragePct: comArea > 0 ? Math.round((1000 * hit.area) / comArea) / 10 : null,
    };
  }
  return {
    path: "clip",
    comPartIds: overlaps.map((hit) => hit.footprint.id),
    osmCoveragePct:
      overlaps.length === 1
        ? Math.round((1000 * overlaps[0].area) / osmArea) / 10
        : null,
    comCoveragePct:
      overlaps.length === 1
        ? Math.round((1000 * overlaps[0].area) / comPartAreaM2(overlaps[0].footprint)) / 10
        : null,
  };
}

/** Classify which path would run for one building (for diagnostics). */
export function classifyComHeightApplication(
  building: BuildingFeat,
  footprints: ComBuildingFootprint[],
): ComHeightPathDetail {
  return classifyWithEligible(building, footprints, singlePartFastPathEligible);
}

/** Classify legacy d835ce1 OSM-only 80% fast path. */
export function classifyComHeightApplicationLegacy(
  building: BuildingFeat,
  footprints: ComBuildingFootprint[],
): ComHeightPathDetail {
  return classifyWithEligible(building, footprints, singlePartLegacyOsmOnlyFastPathEligible);
}

/** Apply CoM heights with single-part fast path and spatial index. */
export function applyComBuildingHeights(
  buildings: BuildingFeat[],
  footprints: ComBuildingFootprint[],
): { buildings: BuildingFeat[]; updated: number } {
  return applyComBuildingHeightsCore(buildings, footprints, { allowFastPath: true });
}

export function tallestExtrusionHeight(building: BuildingFeat): number {
  if (building.extrusionParts?.length) {
    return Math.max(...building.extrusionParts.map((part) => part.height));
  }
  return building.height;
}

export type ComClipStats = {
  clipMs: number;
  extrusionMeshCount: number;
  comExtrusionCount: number;
};

export function applyComBuildingHeightsWithStats(
  buildings: BuildingFeat[],
  footprints: ComBuildingFootprint[],
): { buildings: BuildingFeat[]; updated: number; stats: ComClipStats } {
  const t0 = performance.now();
  const result = applyComBuildingHeights(buildings, footprints);
  const clipMs = performance.now() - t0;
  let extrusionMeshCount = 0;
  for (const building of result.buildings) {
    extrusionMeshCount += building.extrusionParts?.length ?? 1;
  }
  return {
    ...result,
    stats: {
      clipMs,
      extrusionMeshCount,
      comExtrusionCount: result.updated,
    },
  };
}

/** @internal tests */
export function clipBuildingComExtrusionsForTest(
  building: BuildingFeat,
  footprints: ComBuildingFootprint[],
): ExtrusionPart[] | null {
  return clipBuildingComExtrusions(building, footprints);
}
