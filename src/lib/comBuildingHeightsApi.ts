import { squareBBox } from "./geo";
import type { LonLat } from "../types";
import type { BBox } from "./comBuildingHeightsTypes";

export const COM_BUILDINGS_DATASET =
  "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/2023-building-footprints";

export const COM_FETCH_BUFFER_M = 20;
export const COM_RECORDS_PAGE_SIZE = 100;
export const COM_RECORDS_SELECT = "structure_id,structure_extrusion,geo_shape";

/** Expand a cut square by {@link COM_FETCH_BUFFER_M} on each side for CoM queries. */
export function paddedComFetchBounds(center: LonLat, sideM: number, bufferM = COM_FETCH_BUFFER_M): BBox {
  return squareBBox(center, sideM + bufferM * 2);
}

/** WKT POLYGON (lon lat) for ODS `intersects(geo_shape, geom'…')`. Ring is closed. */
export function comRecordsWhereIntersects(bounds: BBox): string {
  const ring = [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
    [bounds.west, bounds.south],
  ] as const;
  const coords = ring.map(([lon, lat]) => `${lon} ${lat}`).join(",");
  return `intersects(geo_shape, geom'POLYGON((${coords}))')`;
}

export function comRecordsQueryUrl(bounds: BBox, offset: number): string {
  const url = new URL(`${COM_BUILDINGS_DATASET}/records`);
  url.searchParams.set("limit", String(COM_RECORDS_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("where", comRecordsWhereIntersects(bounds));
  url.searchParams.set("select", COM_RECORDS_SELECT);
  return url.toString();
}

export function estimateFetchPayloadBytes(recordCount: number): number {
  // Empirical ~450 bytes per row with geo_shape for CBD frames.
  return Math.round(recordCount * 450);
}

export function paddedBoundsCacheKey(bounds: BBox, origin: LonLat): string {
  return ["records-v1", bounds.south, bounds.west, bounds.north, bounds.east, origin.lat, origin.lon]
    .map((v) => (typeof v === "number" ? v.toFixed(6) : v))
    .join(",");
}
