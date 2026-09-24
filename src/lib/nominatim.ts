import type { PlaceHit } from "../types";

type NominatimRow = {
  place_id?: number;
  osm_id?: number;
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: string[];
};

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const base = (import.meta.env.VITE_NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(
    /\/$/,
    "",
  );
  const url = new URL(`${base}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Search failed");
  const rows = (await response.json()) as NominatimRow[];
  return rows.flatMap((row) => {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const display = row.display_name || row.name || "Place";
    const label = row.name || display.split(",")[0] || display;
    let bounds: PlaceHit["bounds"] = null;
    if (row.boundingbox && row.boundingbox.length === 4) {
      const south = Number(row.boundingbox[0]);
      const north = Number(row.boundingbox[1]);
      const west = Number(row.boundingbox[2]);
      const east = Number(row.boundingbox[3]);
      if ([south, north, west, east].every(Number.isFinite)) {
        bounds = [west, south, east, north];
      }
    }
    return [
      {
        id: String(row.place_id ?? row.osm_id ?? `${lat},${lon}`),
        label,
        detail: display,
        lat,
        lon,
        bounds,
      },
    ];
  });
}
