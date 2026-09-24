import type { LonLat, Pt } from "../types";

/** Mean meters per degree of latitude. Fine for a 2 km block. */
export const M_PER_DEG_LAT = 111_132;

export function mPerDegLon(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

export function squareBBox(center: LonLat, sideM: number): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const half = sideM / 2;
  const dLat = half / M_PER_DEG_LAT;
  const dLon = half / mPerDegLon(center.lat);
  return {
    south: center.lat - dLat,
    west: center.lon - dLon,
    north: center.lat + dLat,
    east: center.lon + dLon,
  };
}

export function toLocal(lat: number, lon: number, origin: LonLat): Pt {
  return [
    (lon - origin.lon) * mPerDegLon(origin.lat),
    (lat - origin.lat) * M_PER_DEG_LAT,
  ];
}

export function fromLocal(point: Pt, origin: LonLat): LonLat {
  return {
    lon: origin.lon + point[0] / mPerDegLon(origin.lat),
    lat: origin.lat + point[1] / M_PER_DEG_LAT,
  };
}

export function signedArea(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function dedupeConsecutive(ring: Pt[], epsilon = 0.05): Pt[] {
  const out: Pt[] = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - point[0], last[1] - point[1]) > epsilon) {
      out.push(point);
    }
  }
  return out;
}

/** Drop a repeated closing vertex so callers can close the ring themselves. */
export function openRing(ring: Pt[]): Pt[] {
  const points = dedupeConsecutive(ring);
  if (points.length >= 2) {
    const a = points[0];
    const b = points[points.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.2) points.pop();
  }
  return points;
}

export function polylineLength(line: Pt[]): number {
  let length = 0;
  for (let i = 0; i < line.length - 1; i++) {
    length += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  }
  return length;
}

export function formatKmSide(km: number): string {
  const hundredths = Math.round(km * 100);
  if (hundredths % 10 === 0) return (hundredths / 100).toFixed(1);
  return (hundredths / 100).toFixed(2);
}

export function formatLengthKm(km: number): string {
  if (km >= 10) return km.toFixed(1);
  return km.toFixed(2);
}

export function formatCoord(value: number): string {
  return value.toFixed(5);
}
