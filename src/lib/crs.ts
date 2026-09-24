import proj4 from "proj4";
import { fromLocal } from "./geo";
import type { LonLat, Pt } from "../types";

/**
 * WGS84 is treated as GDA2020. The difference is about a metre in Australia,
 * which is enough for early site work and is not a survey transformation.
 */
export const CRS_NOTE =
  "WGS84 is projected as GDA2020 without a datum shift, about a metre off for site work. The MGA zone follows this block’s longitude; west of 144°E is zone 54 (EPSG:7854).";

/** Official GDA2020 / MGA zone codes are EPSG:7846 through EPSG:7858. */
const MGA_EPSG_ZONE_MIN = 46;
const MGA_EPSG_ZONE_MAX = 58;

export type MgaCrs = {
  zone: number;
  /** Set when this zone has a GDA2020 / MGA EPSG code. */
  epsg: number | null;
  name: string;
};

const converters = new Map<number, proj4.Converter>();

/** Six-degree MGA zone. Zone 55 is [144°E, 150°E). */
export function mgaZone(longitude: number): number {
  if (!Number.isFinite(longitude)) {
    throw new Error("CityCut needs a finite longitude to choose an MGA zone.");
  }
  const lon = Math.min(180, Math.max(-180, longitude));
  if (lon === 180) return 60;
  return Math.floor((lon + 180) / 6) + 1;
}

export function mgaCrs(longitude: number): MgaCrs {
  const zone = mgaZone(longitude);
  const epsg =
    zone >= MGA_EPSG_ZONE_MIN && zone <= MGA_EPSG_ZONE_MAX ? 7800 + zone : null;
  const name =
    epsg != null
      ? `GDA2020 / MGA zone ${zone} (EPSG:${epsg})`
      : `GDA2020 MGA parameters, zone ${zone}`;
  return { zone, epsg, name };
}

/**
 * GDA2020 / MGA: Transverse Mercator, GRS80, scale 0.9996,
 * false easting 500 km, false northing 10,000 km.
 * +towgs84=0 keeps WGS84 and GDA2020 coincident.
 */
function projString(zone: number): string {
  const centralMeridian = zone * 6 - 183;
  return `+proj=tmerc +lat_0=0 +lon_0=${centralMeridian} +k=0.9996 +x_0=500000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs`;
}

function converterFor(zone: number): proj4.Converter {
  const cached = converters.get(zone);
  if (cached) return cached;
  const id = `GDA2020_MGA_${zone}`;
  proj4.defs(id, projString(zone));
  const converter = proj4("EPSG:4326", id);
  converters.set(zone, converter);
  return converter;
}

/** Project a WGS84 longitude/latitude into the given MGA zone. Returns [easting, northing]. */
export function projectLonLat(lon: number, lat: number, zone: number): [number, number] {
  const projected = converterFor(zone).forward([lon, lat]);
  return [projected[0], projected[1]];
}

/**
 * Local east/north metres (the CityModel frame) back to MGA.
 * The whole block stays in one zone, the zone of the cut centre, so a block
 * that straddles a zone boundary does not tear.
 */
export function projectLocal(point: Pt, origin: LonLat, zone: number): [number, number] {
  const geographic = fromLocal(point, origin);
  return projectLonLat(geographic.lon, geographic.lat, zone);
}
