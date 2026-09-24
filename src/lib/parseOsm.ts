import { clipPolygon, clipPolyline } from "./clip";
import { dedupeConsecutive, openRing, polylineLength, signedArea, toLocal } from "./geo";
import { buildingHeight } from "./height";
import type { OverpassElement, OverpassResponse } from "./overpass";
import { resolveArchetype } from "./treeMap";
import { DEFAULT_CROWN_DIAMETER, DEFAULT_TREE_HEIGHT, treeSize } from "./trees";
import type {
  AreaFeat,
  BuildingFeat,
  CityModel,
  LonLat,
  ModelLayers,
  Pt,
  RoadFeat,
  TreeFeat,
} from "../types";

const MAX_BUILDINGS = 4000;
const MAX_TREES = 6000;
const MAX_RELATION_MEMBERS = 80;
const MIN_AREA = 4;

const SKIP_HIGHWAY = new Set([
  "proposed",
  "construction",
  "abandoned",
  "platform",
  "bus_stop",
  "elevator",
  "corridor",
  "raceway",
  "rest_area",
  "services",
  "no",
  "via_ferrata",
  "escalator",
  "escape",
  "bus_guideway",
]);

const ROAD_WIDTH: Record<string, number> = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 9,
  tertiary: 7.5,
  residential: 5.5,
  unclassified: 5,
  living_street: 4.5,
  service: 3.2,
  pedestrian: 6,
  footway: 1.8,
  path: 1.6,
  cycleway: 2.2,
  track: 3,
  steps: 1.4,
  bridleway: 1.8,
  motorway_link: 8,
  trunk_link: 7,
  primary_link: 6.5,
  secondary_link: 5.5,
  tertiary_link: 4.5,
};

type Geom = { lat: number; lon: number };

function pointsFromGeom(geom: Geom[] | undefined, origin: LonLat): Pt[] {
  if (!geom || geom.length === 0) return [];
  const raw: Pt[] = [];
  for (const node of geom) {
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) continue;
    raw.push(toLocal(node.lat, node.lon, origin));
  }
  const closed =
    raw.length >= 4 &&
    Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 1;
  const points = dedupeConsecutive(raw, 0.15);
  if (closed && points.length >= 3) {
    const start = points[0];
    const end = points[points.length - 1];
    if (Math.hypot(start[0] - end[0], start[1] - end[1]) > 0.2) points.push([start[0], start[1]]);
  }
  return points;
}

function isClosed(points: Pt[]): boolean {
  if (points.length < 4) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;
}

function ensureClosed(points: Pt[]): Pt[] {
  if (points.length < 3) return points;
  const a = points[0];
  const b = points[points.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) {
    return [...points.slice(0, -1), a];
  }
  return points;
}

function closeEnough(a: Pt, b: Pt): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.2;
}

/** Join relation member ways that share endpoints into closed rings. */
export function stitchRings(lines: Pt[][]): Pt[][] {
  const pool = lines.map((line) => line.slice()).filter((line) => line.length >= 2);
  const rings: Pt[][] = [];

  while (pool.length > 0) {
    const chain = pool.pop()!;
    let guard = 0;
    while (guard++ < 1000) {
      if (chain.length >= 4 && closeEnough(chain[0], chain[chain.length - 1])) break;
      const end = chain[chain.length - 1];
      const start = chain[0];
      let found = -1;
      let mode = "";
      for (let i = 0; i < pool.length; i++) {
        const way = pool[i];
        const head = way[0];
        const tail = way[way.length - 1];
        if (closeEnough(end, head)) {
          found = i;
          mode = "end-start";
          break;
        }
        if (closeEnough(end, tail)) {
          found = i;
          mode = "end-end";
          break;
        }
        if (closeEnough(start, tail)) {
          found = i;
          mode = "start-end";
          break;
        }
        if (closeEnough(start, head)) {
          found = i;
          mode = "start-start";
          break;
        }
      }
      if (found < 0) break;
      const way = pool.splice(found, 1)[0];
      if (mode === "end-start") chain.push(...way.slice(1));
      else if (mode === "end-end") chain.push(...way.slice(0, -1).reverse());
      else if (mode === "start-end") chain.unshift(...way.slice(0, -1));
      else chain.unshift(...way.slice(1).reverse());
    }
    if (chain.length >= 4 && closeEnough(chain[0], chain[chain.length - 1])) {
      rings.push(ensureClosed(chain));
    }
  }
  return rings;
}

function areaKind(tags: Record<string, string>): "water" | "green" | null {
  if (
    tags.natural === "water" ||
    tags.natural === "wetland" ||
    tags.waterway === "riverbank" ||
    tags.waterway === "dock" ||
    tags.landuse === "reservoir" ||
    tags.water
  ) {
    return "water";
  }
  if (
    tags.leisure === "park" ||
    tags.leisure === "garden" ||
    tags.leisure === "nature_reserve" ||
    tags.leisure === "pitch" ||
    tags.landuse === "forest" ||
    tags.landuse === "grass" ||
    tags.landuse === "meadow" ||
    tags.landuse === "recreation_ground" ||
    tags.landuse === "village_green" ||
    tags.landuse === "cemetery" ||
    tags.natural === "wood" ||
    tags.natural === "scrub"
  ) {
    return "green";
  }
  return null;
}

function hidden(tags: Record<string, string>): boolean {
  return tags.tunnel === "yes" || tags.tunnel === "culvert" || tags.location === "underground" || tags.indoor === "yes";
}

function roadWidth(tags: Record<string, string>): { width: number; kind: "road" | "rail" } | null {
  if (tags.railway) {
    const kind = tags.railway;
    if (!["rail", "light_rail", "tram", "subway", "narrow_gauge"].includes(kind)) return null;
    return { width: kind === "tram" ? 2.8 : 3.6, kind: "rail" };
  }
  const highway = tags.highway;
  if (!highway || SKIP_HIGHWAY.has(highway)) return null;
  const base = highway.split(";")[0];
  return { width: ROAD_WIDTH[base] ?? 4.2, kind: "road" };
}

function ringCentroid(points: Pt[]): Pt | null {
  const open = openRing(points);
  if (open.length === 0) return null;
  let east = 0;
  let north = 0;
  for (const point of open) {
    east += point[0];
    north += point[1];
  }
  return [east / open.length, north / open.length];
}

/** Places along a line, including the start, at about `spacing` metres. */
function pointsAlong(line: Pt[], spacing: number): Pt[] {
  if (line.length === 0) return [];
  const out: Pt[] = [[line[0][0], line[0][1]]];
  if (spacing <= 0) return out;
  let since = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.05) continue;
    let walked = 0;
    while (since + (length - walked) >= spacing - 1e-6) {
      const need = spacing - since;
      walked += need;
      const t = walked / length;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      since = 0;
      if (out.length > 4000) return out;
    }
    since += length - walked;
  }
  return out;
}

function insideCut(at: Pt, half: number): boolean {
  return Math.abs(at[0]) <= half + 0.2 && Math.abs(at[1]) <= half + 0.2;
}

function optionalTag(tags: Record<string, string>, key: string): string | undefined {
  const value = tags[key]?.trim();
  return value ? value : undefined;
}

function pushTree(trees: TreeFeat[], id: number, at: Pt, tags: Record<string, string>, half: number) {
  if (!insideCut(at, half)) return;
  const size = treeSize(tags);
  const genus = optionalTag(tags, "genus");
  const species = optionalTag(tags, "species");
  const taxon = optionalTag(tags, "taxon");
  const leafType = optionalTag(tags, "leaf_type");
  const leafCycle = optionalTag(tags, "leaf_cycle");
  trees.push({
    id,
    at,
    height: size.height,
    crownDiameter: size.crownDiameter,
    ...(genus ? { genus } : {}),
    ...(species ? { species } : {}),
    ...(taxon ? { taxon } : {}),
    ...(leafType ? { leafType } : {}),
    ...(leafCycle ? { leafCycle } : {}),
    archetype: resolveArchetype({ genus, species, taxon, leafType, leafCycle }),
  });
}

function collectTrees(elements: OverpassElement[], origin: LonLat, half: number): TreeFeat[] {
  const trees: TreeFeat[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (hidden(tags)) continue;
    if (element.type === "node") {
      if (tags.natural !== "tree" || element.lat == null || element.lon == null) continue;
      pushTree(trees, element.id, toLocal(element.lat, element.lon, origin), tags, half);
      continue;
    }
    if (element.type !== "way") continue;
    if (tags.natural !== "tree" && tags.natural !== "tree_row") continue;
    const line = pointsFromGeom(element.geometry, origin);
    if (line.length < 2) continue;
    if (tags.natural === "tree" && isClosed(line)) {
      const at = ringCentroid(line);
      if (at) pushTree(trees, element.id, at, tags, half);
      continue;
    }
    const size = treeSize(tags);
    const spacing = Math.min(14, Math.max(6, size.crownDiameter));
    for (const part of clipPolyline(line, -half, half)) {
      for (const point of pointsAlong(part, spacing)) {
        pushTree(trees, element.id, point, tags, half);
      }
    }
  }
  return trees;
}

function clipRing(points: Pt[], half: number): Pt[] {
  const clipped = clipPolygon(points, -half, half);
  if (clipped.length < 3) return [];
  if (Math.abs(signedArea(clipped)) < MIN_AREA) return [];
  return clipped;
}

function pushArea(
  areas: AreaFeat[],
  id: number,
  kind: "water" | "green",
  outer: Pt[],
  holes: Pt[][],
  half: number,
) {
  const ring = clipRing(outer, half);
  if (ring.length < 3) return;
  const clippedHoles = holes
    .map((hole) => clipRing(hole, half))
    .filter((hole) => hole.length >= 3);
  areas.push({ id, kind, ring, holes: clippedHoles });
}

function relationRings(
  element: OverpassElement,
  origin: LonLat,
): { outers: Pt[][]; inners: Pt[][]; used: number[] } | null {
  const members = element.members ?? [];
  if (members.length === 0 || members.length > MAX_RELATION_MEMBERS) return null;
  const outers: Pt[][] = [];
  const inners: Pt[][] = [];
  const used: number[] = [];
  for (const member of members) {
    if (member.type !== "way" || !member.geometry) continue;
    const line = pointsFromGeom(member.geometry, origin);
    if (line.length < 2) continue;
    used.push(member.ref);
    if (member.role === "inner") inners.push(line);
    else outers.push(line);
  }
  return { outers, inners, used };
}

export function parseCity(
  data: OverpassResponse,
  origin: LonLat,
  sideM: number,
  layers: ModelLayers,
): Omit<CityModel, "placeLabel" | "sourceNote"> & { sourceNote: string } {
  const half = sideM / 2;
  const buildings: BuildingFeat[] = [];
  const roads: RoadFeat[] = [];
  const areas: AreaFeat[] = [];
  const consumedWays = new Set<number>();
  let roadMeters = 0;

  const elements = data.elements ?? [];
  let trees = layers.trees ? collectTrees(elements, origin, half) : [];
  let treeCapHit = false;
  if (trees.length > MAX_TREES) {
    treeCapHit = true;
    const step = trees.length / MAX_TREES;
    const kept: TreeFeat[] = [];
    for (let i = 0; i < MAX_TREES; i++) {
      kept.push(trees[Math.min(trees.length - 1, Math.floor(i * step))]);
    }
    trees = kept;
  }

  if (layers.buildings || layers.waterGreen) {
    for (const element of elements) {
      if (element.type !== "relation") continue;
      const tags = element.tags ?? {};
      const buildingRel = layers.buildings && tags.building && tags.building !== "no" && tags.building !== "entrance";
      const kind = layers.waterGreen ? areaKind(tags) : null;
      if (!buildingRel && !kind) continue;
      const stitched = relationRings(element, origin);
      if (!stitched) continue;
      const rings = stitchRings(stitched.outers);
      const holes = rings.length === 1 ? stitchRings(stitched.inners) : [];
      if (rings.length === 0) continue;
      for (const ref of stitched.used) consumedWays.add(ref);
      if (buildingRel) {
        for (const ring of rings) {
          const clipped = clipRing(ring, half);
          if (clipped.length < 3) continue;
          buildings.push({
            id: element.id,
            ring: clipped,
            holes: holes.map((hole) => clipRing(hole, half)).filter((hole) => hole.length >= 3),
            height: buildingHeight(tags),
          });
        }
      } else if (kind) {
        for (const ring of rings) pushArea(areas, element.id, kind, ring, holes, half);
      }
    }
  }

  for (const element of elements) {
    if (element.type !== "way") continue;
    const tags = element.tags ?? {};
    const line = pointsFromGeom(element.geometry, origin);
    if (line.length < 2) continue;

    if (layers.buildings && tags.building && tags.building !== "no" && tags.building !== "entrance" && !tags["building:part"]) {
      if (consumedWays.has(element.id)) continue;
      if (!isClosed(line)) continue;
      const clipped = clipRing(line, half);
      if (clipped.length < 3) continue;
      buildings.push({
        id: element.id,
        ring: clipped,
        holes: [],
        height: buildingHeight(tags),
      });
      continue;
    }

    if (layers.waterGreen && !consumedWays.has(element.id)) {
      const kind = areaKind(tags);
      if (kind && isClosed(line)) {
        pushArea(areas, element.id, kind, line, [], half);
        continue;
      }
    }

    if (layers.roads && !hidden(tags)) {
      const spec = roadWidth(tags);
      if (!spec) continue;
      const parts = clipPolyline(line, -half, half);
      for (const part of parts) {
        if (polylineLength(part) < 1) continue;
        roads.push({ id: element.id, line: part, width: spec.width, kind: spec.kind });
        roadMeters += polylineLength(part);
      }
    }
  }

  let buildingCapHit = false;
  let kept = buildings;
  if (buildings.length > MAX_BUILDINGS) {
    buildingCapHit = true;
    kept = buildings
      .slice()
      .sort((a, b) => Math.abs(signedArea(b.ring)) - Math.abs(signedArea(a.ring)))
      .slice(0, MAX_BUILDINGS);
  }

  const notes = [
    "OpenStreetMap via Overpass.",
    "Building height uses the height tag, otherwise building:levels × 3 m, otherwise 9 m.",
    "Ground is flat — no lidar or terrain in this version.",
  ];
  if (layers.trees) {
    notes.push(
      `Trees use height and crown diameter tags when present, otherwise ${DEFAULT_TREE_HEIGHT} m tall and ${DEFAULT_CROWN_DIAMETER} m across. Genus, species, taxon, and leaf tags choose a massing archetype.`,
    );
  }
  if (buildingCapHit) notes.push(`Building count was capped at ${MAX_BUILDINGS}.`);
  if (treeCapHit) notes.push(`Tree count was capped at ${MAX_TREES}.`);

  return {
    center: origin,
    sideM,
    layers,
    buildings: kept,
    roads,
    areas,
    trees,
    roadKm: roadMeters / 1000,
    buildingCapHit,
    sourceNote: notes.join(" "),
  };
}
