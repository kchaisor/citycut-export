import { applyComBuildingHeights, fetchComBuildingFootprints, tallestExtrusionHeight } from "../src/lib/comBuildingHeights.ts";
import { buildingHeight } from "../src/lib/height.ts";
import { openRing, toLocal } from "../src/lib/geo.ts";

const towers = [
  { name: "Rialto", osmWayId: 14665796 },
  { name: "120 Collins Street", osmWayId: 22931324 },
  { name: "101 Collins Street", osmWayId: 140834631 },
  { name: "Aurora Melbourne Central", osmWayId: 114114375 },
  { name: "Eureka Tower (107425933)", osmWayId: 107425933 },
  { name: "Eureka Tower (13307317)", osmWayId: 13307317 },
];

async function loadWay(id) {
  const res = await fetch(`https://api.openstreetmap.org/api/0.6/way/${id}/full`);
  const xml = await res.text();
  const nodes = new Map();
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g)) {
    nodes.set(Number(m[1]), { lat: Number(m[2]), lon: Number(m[3]) });
  }
  const b = xml.match(new RegExp(`<way id="${id}"[\\s\\S]*?</way>`));
  const coords = [];
  for (const nd of b[0].matchAll(/<nd ref="(\d+)"/g)) {
    const n = nodes.get(Number(nd[1]));
    if (n) coords.push(n);
  }
  const tags = {};
  for (const t of b[0].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
  return { coords, tags };
}

for (const tower of towers) {
  const { coords, tags } = await loadWay(tower.osmWayId);
  const meanLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const meanLon = coords.reduce((s, c) => s + c.lon, 0) / coords.length;
  const origin = { lon: meanLon, lat: meanLat };
  const ring = openRing(coords.map((c) => toLocal(c.lat, c.lon, origin)));
  const building = {
    id: tower.osmWayId,
    ring,
    holes: [],
    height: buildingHeight(tags),
    use: "commercial",
    source: "osm",
  };
  const pad = 0.0018;
  const bounds = { south: meanLat - pad, north: meanLat + pad, west: meanLon - pad, east: meanLon + pad };
  const footprints = await fetchComBuildingFootprints(bounds, origin);
  const off = building.height;
  const applied = applyComBuildingHeights([building], footprints).buildings[0];
  const on = tallestExtrusionHeight(applied);
  console.log(JSON.stringify({ name: tower.name, osmId: tower.osmWayId, off, on, parts: applied.extrusionParts?.length ?? 1 }));
}
