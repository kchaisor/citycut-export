/**
 * Performance benchmark for 1 km CBD CoM heights. Run: npx vite-node scripts/bench-com-clip.mjs
 */
import { buildCityGroup, disposeObject } from "../src/lib/buildCity.ts";
import {
  applyComBuildingHeightsWithStats,
  clearComBuildingFootprintCache,
  fetchComBuildingFootprintsWithStats,
  paddedComFetchBounds,
  countBuildingsWithComDerivedExtrusion,
} from "../src/lib/comBuildingHeights.ts";
import { runComBuildingHeightsInWorker } from "../src/lib/comBuildingHeightsWorkerClient.ts";
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
const query = buildOverpassQuery(bbox, { buildings: true, roads: true, waterGreen: true, trees: false });

const overpass = await fetchOverpass(query);
const parsed = parseCity(overpass, center, sideM, { buildings: true, roads: true, waterGreen: true, trees: false });

clearComBuildingFootprintCache();
const { footprints, stats: fetchStats } = await fetchComBuildingFootprintsWithStats(bounds, center);

const workerT0 = performance.now();
const workerResult = await runComBuildingHeightsInWorker(parsed.buildings, footprints);
const workerMs = performance.now() - workerT0;

const { buildings, stats: clipStats } = applyComBuildingHeightsWithStats(parsed.buildings, footprints);
const uiCount = countBuildingsWithComDerivedExtrusion(parsed.buildings, workerResult.buildings);
const benchmarkCount = countBuildingsWithComDerivedExtrusion(parsed.buildings, buildings);

const meshT0 = performance.now();
const group = buildCityGroup({ ...parsed, buildings: workerResult.buildings }, { splitBuildings: true });
const meshMs = performance.now() - meshT0;
disposeObject(group);

const totalMs = fetchStats.fetchMs + workerMs + meshMs;

console.log(
  JSON.stringify(
    {
      buildings: parsed.buildings.length,
      comFootprints: footprints.length,
      comExtrusionCount: uiCount,
      benchmarkCount,
      workerUpdated: workerResult.updated,
      syncClipMs: Math.round(clipStats.clipMs),
      fetchMs: Math.round(fetchStats.fetchMs),
      workerMs: Math.round(workerMs),
      meshMs: Math.round(meshMs),
      totalMs: Math.round(totalMs),
      requestCount: fetchStats.requestCount,
      recordCount: fetchStats.recordCount,
      payloadBytes: fetchStats.payloadBytes,
      extrusionMeshCount: clipStats.extrusionMeshCount,
    },
    null,
    2,
  ),
);
