import { openRing, toLocal } from "./geo";
import { clampBuildingHeight } from "./height";
import type { BuildingFeat, LonLat, Pt, Ring } from "../types";
import {
  COM_RECORDS_PAGE_SIZE,
  comRecordsQueryUrl,
  estimateFetchPayloadBytes,
  paddedBoundsCacheKey,
} from "./comBuildingHeightsApi";
import { attachFootprintBBox, intersectionAreaM2 } from "./comBuildingHeightsMatch";
import type { BBox, ComBuildingFootprint } from "./comBuildingHeightsTypes";

export {
  COM_BUILDINGS_DATASET,
  COM_FETCH_BUFFER_M,
  COM_RECORDS_PAGE_SIZE,
  comRecordsWhereIntersects,
  paddedComFetchBounds,
} from "./comBuildingHeightsApi";
export type { BBox, ComBuildingFootprint } from "./comBuildingHeightsTypes";
export {
  applyComBuildingHeights,
  applyComBuildingHeightsClipOnly,
  applyComBuildingHeightsLegacyOsmOnlyFastPath,
  applyComBuildingHeightsWithStats,
  classifyComHeightApplication,
  classifyComHeightApplicationLegacy,
  attachFootprintBBox,
  COM_SINGLE_PART_COVERAGE,
  COM_SLIVER_MIN_FRACTION,
  COM_SLIVER_MIN_M2,
  COM_FALLBACK_MIN_FRACTION,
  intersectionAreaM2,
  pickComHeightFallback20,
  ringBBox,
  tallestExtrusionHeight,
  clipBuildingComExtrusionsForTest as clipBuildingComExtrusions,
} from "./comBuildingHeightsMatch";
export type { ComClipStats } from "./comBuildingHeightsMatch";
export {
  buildingHasComDerivedExtrusion,
  countBuildingsWithComDerivedExtrusion,
} from "./comBuildingHeightsCount";

export const COM_BUILDING_HEIGHT_ATTRIBUTION =
  "2023 Building Footprints © City of Melbourne (CC BY 4.0).";

/** Padded City of Melbourne extent. Outside this the inventory has no rows. */
export const COM_CITY_EXTENT = { south: -37.86, west: 144.89, north: -37.77, east: 145.0 };

type GeoShape = {
  type?: string;
  geometry?: {
    type?: string;
    coordinates?: number[][][] | number[][][][];
  };
};

type ApiRow = {
  structure_id?: string;
  structure_extrusion?: number | null;
  geo_shape?: GeoShape;
};

const footprintCache = new Map<string, ComBuildingFootprint[]>();

export function intersectsComCity(bounds: BBox): boolean {
  return !(
    bounds.north < COM_CITY_EXTENT.south ||
    bounds.south > COM_CITY_EXTENT.north ||
    bounds.east < COM_CITY_EXTENT.west ||
    bounds.west > COM_CITY_EXTENT.east
  );
}

function ringFromLonLat(coords: number[][], origin: LonLat): Ring {
  return openRing(coords.map(([lon, lat]) => toLocal(lat, lon, origin)));
}

function footprintsFromGeometry(row: ApiRow, geom: NonNullable<GeoShape["geometry"]>, origin: LonLat): ComBuildingFootprint[] {
  const height = row.structure_extrusion;
  if (typeof height !== "number" || !(height > 0)) return [];
  if (!geom.coordinates) return [];
  const id = row.structure_id?.trim() || "";
  const height_m = clampBuildingHeight(height);
  const out: ComBuildingFootprint[] = [];
  if (geom.type === "Polygon") {
    const rings = geom.coordinates as number[][][];
    if (!rings[0]?.length) return [];
    out.push(
      attachFootprintBBox(
        id,
        ringFromLonLat(rings[0], origin),
        rings.slice(1).map((hole) => ringFromLonLat(hole, origin)),
        height_m,
      ),
    );
    return out;
  }
  if (geom.type === "MultiPolygon") {
    const parts = geom.coordinates as number[][][][];
    for (const poly of parts) {
      if (!poly[0]?.length) continue;
      out.push(
        attachFootprintBBox(
          id,
          ringFromLonLat(poly[0], origin),
          poly.slice(1).map((hole) => ringFromLonLat(hole, origin)),
          height_m,
        ),
      );
    }
  }
  return out;
}

function footprintsFromRecord(row: ApiRow, origin: LonLat): ComBuildingFootprint[] {
  const shape = row.geo_shape;
  const geom =
    shape?.geometry ??
    (shape?.type === "Polygon" || shape?.type === "MultiPolygon" ? (shape as GeoShape["geometry"]) : null);
  if (!geom?.coordinates) return [];
  return footprintsFromGeometry(row, geom, origin);
}

export type ComFetchStats = {
  requestCount: number;
  recordCount: number;
  payloadBytes: number;
  fetchMs: number;
};

async function loadRecordsIntoCache(bounds: BBox, origin: LonLat, signal?: AbortSignal): Promise<{
  footprints: ComBuildingFootprint[];
  requestCount: number;
  recordCount: number;
  payloadBytes: number;
}> {
  const key = paddedBoundsCacheKey(bounds, origin);
  const cached = footprintCache.get(key);
  if (cached) return { footprints: cached, requestCount: 0, recordCount: cached.length, payloadBytes: 0 };

  const footprints: ComBuildingFootprint[] = [];
  let requestCount = 0;
  let recordCount = 0;
  let payloadBytes = 0;

  async function fetchPage(offset: number): Promise<{ total: number; rows: ApiRow[]; bytes: number }> {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    requestCount += 1;
    const response = await fetch(comRecordsQueryUrl(bounds, offset), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`City of Melbourne building records answered ${response.status}.`);
    const bodyText = await response.text();
    const json = JSON.parse(bodyText) as { total_count?: number; results?: ApiRow[] };
    return { total: json.total_count ?? 0, rows: json.results ?? [], bytes: bodyText.length };
  }

  const first = await fetchPage(0);
  payloadBytes += first.bytes;
  recordCount += first.rows.length;
  for (const row of first.rows) {
    footprints.push(...footprintsFromRecord(row, origin));
  }
  const total = first.total;
  if (first.rows.length === 0 || total <= first.rows.length) {
    footprintCache.set(key, footprints);
    return { footprints, requestCount, recordCount, payloadBytes };
  }

  const offsets: number[] = [];
  for (let offset = first.rows.length; offset < total; offset += COM_RECORDS_PAGE_SIZE) {
    offsets.push(offset);
  }
  const pageResults = await Promise.all(offsets.map((offset) => fetchPage(offset)));
  for (const page of pageResults) {
    payloadBytes += page.bytes;
    recordCount += page.rows.length;
    for (const row of page.rows) {
      footprints.push(...footprintsFromRecord(row, origin));
    }
  }
  footprintCache.set(key, footprints);
  return { footprints, requestCount, recordCount, payloadBytes };
}

export async function fetchComBuildingFootprints(
  bounds: BBox,
  origin: LonLat,
  signal?: AbortSignal,
): Promise<ComBuildingFootprint[]> {
  if (!intersectsComCity(bounds)) return [];
  const { footprints } = await loadRecordsIntoCache(bounds, origin, signal);
  return footprints;
}

export async function fetchComBuildingFootprintsWithStats(
  bounds: BBox,
  origin: LonLat,
  signal?: AbortSignal,
): Promise<{ footprints: ComBuildingFootprint[]; stats: ComFetchStats }> {
  const t0 = performance.now();
  const { footprints, requestCount, recordCount, payloadBytes } = await loadRecordsIntoCache(
    bounds,
    origin,
    signal,
  );
  return {
    footprints,
    stats: {
      requestCount,
      recordCount,
      payloadBytes: payloadBytes || estimateFetchPayloadBytes(recordCount),
      fetchMs: performance.now() - t0,
    },
  };
}

/** @internal test helper */
export function clearComBuildingFootprintCache(): void {
  footprintCache.clear();
}

export function centroid(ring: Ring): Pt {
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) {
    x += px;
    y += py;
  }
  const n = ring.length || 1;
  return [x / n, y / n];
}

export function pickComHeight(
  building: BuildingFeat,
  footprints: ComBuildingFootprint[],
): ComBuildingFootprint | null {
  let best: ComBuildingFootprint | null = null;
  let bestArea = 0;
  const center = centroid(building.ring);
  for (const footprint of footprints) {
    const overlap = intersectionAreaM2(building, footprint);
    if (overlap > bestArea) {
      bestArea = overlap;
      best = footprint;
      continue;
    }
    if (overlap === 0 && bestArea === 0 && pointInRing(center, footprint.ring)) {
      best = footprint;
    }
  }
  return best;
}

function pointInRing(point: Pt, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
