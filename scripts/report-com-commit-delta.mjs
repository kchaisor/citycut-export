/**
 * Buildings for Kelvin review: clip (0a8b37a logic) vs d835ce1 legacy fast vs bidirectional fix.
 */
import {
  applyComBuildingHeightsClipOnly,
  applyComBuildingHeightsLegacyOsmOnlyFastPath,
  applyComBuildingHeights,
  clearComBuildingFootprintCache,
  fetchComBuildingFootprints,
  paddedComFetchBounds,
  tallestExtrusionHeight,
  classifyComHeightApplicationLegacy,
  classifyComHeightApplication,
} from "../src/lib/comBuildingHeights.ts";
import { fetchOverpass, overpassBBox, buildOverpassQuery } from "../src/lib/overpass.ts";
import { parseCity } from "../src/lib/parseOsm.ts";

const center = { lon: 144.9631, lat: -37.8136 };
const sideM = 1000;
const bounds = paddedComFetchBounds(center, sideM);
const bbox = overpassBBox({
  south: center.lat - sideM / 2 / 111_132,
  north: center.lat + sideM / 2 / 111_132,
  west: center.lon - sideM / 2 / (111_320 * Math.cos((center.lat * Math.PI) / 180)),
  east: center.lon + sideM / 2 / (111_320 * Math.cos((center.lat * Math.PI) / 180)),
});
const overpass = await fetchOverpass(
  buildOverpassQuery(bbox, { buildings: true, roads: true, waterGreen: true, trees: false }),
);
const parsed = parseCity(overpass, center, sideM, {
  buildings: true,
  roads: true,
  waterGreen: true,
  trees: false,
});
const wayTags = new Map();
for (const el of overpass.elements) {
  if (el.type === "way" && el.tags) wayTags.set(el.id, el.tags);
}
clearComBuildingFootprintCache();
const fp = await fetchComBuildingFootprints(bounds, center);
const clip = applyComBuildingHeightsClipOnly(parsed.buildings, fp);
const leg = applyComBuildingHeightsLegacyOsmOnlyFastPath(parsed.buildings, fp);
const fixed = applyComBuildingHeights(parsed.buildings, fp);

const rows = [];
for (let i = 0; i < parsed.buildings.length; i++) {
  const osmH = parsed.buildings[i].height;
  const hClip = tallestExtrusionHeight(clip.buildings[i]);
  const hLeg = tallestExtrusionHeight(leg.buildings[i]);
  const hFix = tallestExtrusionHeight(fixed.buildings[i]);
  const maxDelta = Math.max(Math.abs(hLeg - hClip), Math.abs(hFix - hClip));
  const legacyDetail = classifyComHeightApplicationLegacy(parsed.buildings[i], fp);
  const fixedDetail = classifyComHeightApplication(parsed.buildings[i], fp);
  const slabRisk =
    legacyDetail.path === "fast" &&
    (legacyDetail.comCoveragePct ?? 100) < 80 &&
    !leg.buildings[i].extrusionParts &&
    hLeg - osmH > 20;
  if (maxDelta <= 20 && !slabRisk && fixedDetail.path === legacyDetail.path) continue;
  const tags = wayTags.get(parsed.buildings[i].id) ?? {};
  rows.push({
    osmId: parsed.buildings[i].id,
    label: tags.name || tags.building || parsed.buildings[i].use,
    height0a8b37aClip: Math.round(hClip * 10) / 10,
    heightD835ce1LegacyFast: Math.round(hLeg * 10) / 10,
    heightAfterBidirectionalFix: Math.round(hFix * 10) / 10,
    pathD835ce1: legacyDetail.path,
    pathAfterFix: fixedDetail.path,
    comPartIds: [...new Set(legacyDetail.comPartIds)],
    osmCoveragePct: legacyDetail.osmCoveragePct,
    comCoveragePct: legacyDetail.comCoveragePct,
    slabWholeFootprintRisk: slabRisk,
  });
}
rows.sort(
  (a, b) =>
    (b.slabWholeFootprintRisk ? 1 : 0) - (a.slabWholeFootprintRisk ? 1 : 0) ||
    Math.abs(b.heightD835ce1LegacyFast - b.height0a8b37aClip) -
      Math.abs(a.heightD835ce1LegacyFast - a.height0a8b37aClip),
);
console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
