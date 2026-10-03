import * as THREE from "three";
import type { PdfChunk, Rgb } from "./aiDocument";
import { useNativeAi8Export } from "./aiExportFormat";
import { buildLayeredNativeAi } from "./aiNative";
import { buildLayeredNativeAiPdfOps } from "./aiNativePdfFallback";
import { buildLayeredPdf } from "./aiDocument";
import type { CameraShot } from "./cameraShot";
import { BUILDING_USE_META, SOURCE_META, uniformBuildingColor } from "./buildingUse";
import { getColour, type ColourKey } from "./colours";
import { formatCoord, openRing, signedArea } from "./geo";
import { hexRgb } from "./lineweights";
import { ROAD_COLOR, SURFACE } from "./surfaceLayers";
import { footprintBase, sampleTerrain } from "./terrain";
import { comBuildingHeightCreditLine } from "./comBuildingHeightCredit";
import type { BuildingFeat, CityModel, Pt, Ring } from "../types";

export const VIEW_LAYER_ORDER = [
  "Ground",
  "Roads",
  "Water",
  "Green",
  "Buildings",
  "Trees",
  "Outlines",
  "Annotation",
] as const;

/** Visible building edges on the 3D sheet. Not a true-scale pen from the plan table. */
export const VIEW_OUTLINE_MM = 0.18;

const PAGE_LONG_MM = 340;
const LIGHT: Vec3 = normalize([0.4, 1, 0.2]);

function fillOf(name: ColourKey): Rgb {
  return hexRgb(getColour(name));
}

type Vec3 = [number, number, number];
export type ScreenPoint = { x: number; y: number; z: number };
type V2 = ScreenPoint;

export type ScreenTri = {
  a: V2;
  b: V2;
  c: V2;
  id: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Occ = ScreenTri;

export type ViewStyle = {
  uniformBuildings: boolean;
  colourBySource: boolean;
};

type Fill = {
  depth: number;
  rank: number;
  chunk: PdfChunk;
  occ: Occ[];
};

type Edge = { a: V2; b: V2; id: number };

export function viewPageMm(widthPx: number, heightPx: number): { widthMm: number; heightMm: number } {
  const aspect = widthPx / Math.max(heightPx, 1);
  if (aspect >= 1) return { widthMm: PAGE_LONG_MM, heightMm: PAGE_LONG_MM / aspect };
  return { widthMm: PAGE_LONG_MM * aspect, heightMm: PAGE_LONG_MM };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function facesCamera(normal: Vec3, forward: Vec3): boolean {
  return dot(normal, forward) < -1e-5;
}

/** Ground, roads, and roofs should face the sky. Wall quads keep the winding they were given. */
function faceUp(corners: Vec3[]): Vec3[] {
  if (corners.length < 3) return corners;
  const normal = cross(
    [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]],
    [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]],
  );
  if (normal[1] >= 0) return corners;
  return [corners[0], ...corners.slice(1).reverse()];
}

function lit(color: Rgb, normal: Vec3, strength = 0.58): Rgb {
  const n = normalize(normal);
  const ndotl = Math.max(0, dot(n, LIGHT));
  const factor = Math.min(1, 1 - strength + strength * ndotl);
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function project(shot: CameraShot, world: Vec3, pageW: number, pageH: number): V2 | null {
  const e = shot.projectionView;
  const x = world[0];
  const y = world[1];
  const z = world[2];
  const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
  const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (!(cw > 1e-4)) return null;
  const inv = 1 / cw;
  const ndcX = cx * inv;
  const ndcY = cy * inv;
  const ndcZ = cz * inv;
  if (ndcZ < -1.02 || ndcZ > 1.02) return null;
  return {
    x: (ndcX * 0.5 + 0.5) * pageW,
    y: (ndcY * 0.5 + 0.5) * pageH,
    z: ndcZ,
  };
}

function worldOf(east: number, north: number, y: number): Vec3 {
  return [east, y, -north];
}

function orient(ring: Ring, ccw: boolean): Pt[] {
  const points = openRing(ring);
  if (points.length < 3) return points;
  if (signedArea(points) > 0 !== ccw) points.reverse();
  return points;
}

function buildingColor(building: BuildingFeat, style: ViewStyle): Rgb {
  if (style.colourBySource) return hexRgb(SOURCE_META[building.source].color);
  if (style.uniformBuildings) return hexRgb(uniformBuildingColor());
  return hexRgb(BUILDING_USE_META[building.use].color);
}

function triArea(a: V2, b: V2, c: V2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function occOf(a: V2, b: V2, c: V2, id: number): Occ | null {
  if (Math.abs(triArea(a, b, c)) < 0.02) return null;
  return {
    a,
    b,
    c,
    id,
    minX: Math.min(a.x, b.x, c.x),
    minY: Math.min(a.y, b.y, c.y),
    maxX: Math.max(a.x, b.x, c.x),
    maxY: Math.max(a.y, b.y, c.y),
  };
}

function lerp(a: V2, b: V2, t: number): V2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Portion of segment ab inside a CCW triangle, as parameters along ab. */
function segmentInTri(a: V2, b: V2, tri: Occ): [number, number] | null {
  let p0 = tri.a;
  let p1 = tri.b;
  let p2 = tri.c;
  if (triArea(p0, p1, p2) < 0) {
    const swap = p1;
    p1 = p2;
    p2 = swap;
  }
  const poly = [p0, p1, p2];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % 3];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const c0 = cross2(ex, ey, a.x - p.x, a.y - p.y);
    const c1 = cross2(ex, ey, b.x - a.x, b.y - a.y);
    if (Math.abs(c1) < 1e-9) {
      if (c0 < -1e-6) return null;
      continue;
    }
    const t = -c0 / c1;
    if (c1 > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1 + 1e-6) return null;
  }
  if (t1 < t0) return null;
  return [t0, t1];
}

function baryZ(x: number, y: number, tri: Occ): number | null {
  const a = tri.a;
  const b = tri.b;
  const c = tri.c;
  const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denom) < 1e-9) return null;
  const w0 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom;
  const w1 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom;
  const w2 = 1 - w0 - w1;
  if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) return null;
  return w0 * a.z + w1 * b.z + w2 * c.z;
}

const GRID = 28;

/**
 * Removes the parts of an edge that pass through a nearer face.
 * Depth is NDC z (smaller is closer), interpolated in screen space the way a
 * rasterizer compares fragments. A face does not hide its own edges, and a
 * coplanar neighbour is left alone by the depth bias.
 */
export function clipEdge(a: V2, b: V2, occluders: Occ[], faceId: number): Array<[V2, V2]> {
  let parts: Array<[V2, V2]> = [[a, b]];
  for (const tri of occluders) {
    if (tri.id === faceId) continue;
    const next: Array<[V2, V2]> = [];
    for (const [p, q] of parts) {
      if (
        Math.max(p.x, q.x) < tri.minX ||
        Math.min(p.x, q.x) > tri.maxX ||
        Math.max(p.y, q.y) < tri.minY ||
        Math.min(p.y, q.y) > tri.maxY
      ) {
        next.push([p, q]);
        continue;
      }
      const interval = segmentInTri(p, q, tri);
      if (!interval) {
        next.push([p, q]);
        continue;
      }
      const [t0, t1] = interval;
      if (t1 - t0 < 1e-4) {
        next.push([p, q]);
        continue;
      }
      const mid = (t0 + t1) / 2;
      const at = lerp(p, q, mid);
      const cover = baryZ(at.x, at.y, tri);
      if (cover == null || cover >= at.z - 8e-4) {
        next.push([p, q]);
        continue;
      }
      if (t0 > 0.004) next.push([p, lerp(p, q, t0)]);
      if (t1 < 0.996) next.push([lerp(p, q, t1), q]);
    }
    parts = next;
    if (parts.length === 0) break;
  }
  return parts.filter(([p, q]) => Math.hypot(q.x - p.x, q.y - p.y) > 0.12);
}

function gridIndex(occ: Occ[], pageW: number, pageH: number): Occ[][] {
  const cells: Occ[][] = Array.from({ length: GRID * GRID }, () => []);
  for (const tri of occ) {
    if (!Number.isFinite(tri.minX) || !Number.isFinite(tri.maxX) || !Number.isFinite(tri.minY) || !Number.isFinite(tri.maxY)) {
      continue;
    }
    if (tri.maxX < 0 || tri.minX > pageW || tri.maxY < 0 || tri.minY > pageH) continue;
    const x0 = Math.max(0, Math.floor((tri.minX / pageW) * GRID));
    const x1 = Math.min(GRID - 1, Math.floor((tri.maxX / pageW) * GRID));
    const y0 = Math.max(0, Math.floor((tri.minY / pageH) * GRID));
    const y1 = Math.min(GRID - 1, Math.floor((tri.maxY / pageH) * GRID));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) cells[y * GRID + x].push(tri);
    }
  }
  return cells;
}

function candidates(cells: Occ[][], a: V2, b: V2, pageW: number, pageH: number): Occ[] {
  const seen = new Set<Occ>();
  const out: Occ[] = [];
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const cx0 = Math.min(GRID - 1, Math.max(0, Math.floor((x0 / pageW) * GRID)));
  const cx1 = Math.min(GRID - 1, Math.max(0, Math.floor((x1 / pageW) * GRID)));
  const cy0 = Math.min(GRID - 1, Math.max(0, Math.floor((y0 / pageH) * GRID)));
  const cy1 = Math.min(GRID - 1, Math.max(0, Math.floor((y1 / pageH) * GRID)));
  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      for (const tri of cells[y * GRID + x]) {
        if (seen.has(tri)) continue;
        seen.add(tri);
        out.push(tri);
      }
    }
  }
  return out;
}

function shapeTriangles(outer: Pt[], holes: Pt[][], yAt: (east: number, north: number) => number): Vec3[][] {
  const contour = orient(outer, true);
  if (contour.length < 3) return [];
  const shape = new THREE.Shape();
  shape.moveTo(contour[0][0], contour[0][1]);
  for (let i = 1; i < contour.length; i++) shape.lineTo(contour[i][0], contour[i][1]);
  shape.closePath();
  for (const hole of holes) {
    const inner = orient(hole, false);
    if (inner.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(inner[0][0], inner[0][1]);
    for (let i = 1; i < inner.length; i++) path.lineTo(inner[i][0], inner[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  let geometry: THREE.ShapeGeometry;
  try {
    geometry = new THREE.ShapeGeometry(shape);
  } catch {
    return [];
  }
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const at = (vertex: number): Vec3 => {
    const east = position.getX(vertex);
    const north = position.getY(vertex);
    return worldOf(east, north, yAt(east, north));
  };
  const tris: Vec3[][] = [];
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) tris.push([at(index.getX(i)), at(index.getX(i + 1)), at(index.getX(i + 2))]);
  } else {
    for (let i = 0; i + 2 < position.count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
  }
  geometry.dispose();
  return tris;
}

function pushTri(
  fills: Fill[],
  edges: Edge[],
  occ: Occ[],
  id: number,
  corners: Vec3[],
  color: Rgb,
  layer: Fill["chunk"]["name"],
  rank: number,
  outline: boolean,
  shot: CameraShot,
  pageW: number,
  pageH: number,
  forward: Vec3,
) {
  if (corners.length < 3) return;
  const normal = cross(
    [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]],
    [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]],
  );
  if (!facesCamera(normal, forward)) return;
  const projected = corners.map((corner) => project(shot, corner, pageW, pageH));
  if (projected.some((point) => point === null)) return;
  const poly = projected as V2[];
  const shade = lit(color, normal, layer === "Ground" ? 0.22 : 0.58);
  const depth = poly.reduce((sum, point) => sum + point.z, 0) / poly.length;
  const faceOcc: Occ[] = [];
  for (let i = 1; i < poly.length - 1; i++) {
    const tri = occOf(poly[0], poly[i], poly[i + 1], id);
    if (tri) faceOcc.push(tri);
  }
  if (faceOcc.length === 0 && poly.length === 3) return;
  fills.push({
    depth,
    rank,
    occ: layer === "Buildings" ? faceOcc : [],
    chunk: {
      name: layer,
      paths: [
        {
          rings: [poly.map((point) => [point.x, point.y])],
          fill: shade,
          close: true,
          evenOdd: false,
        },
      ],
    },
  });
  if (outline) {
    for (let i = 0; i < poly.length; i++) edges.push({ a: poly[i], b: poly[(i + 1) % poly.length], id });
  }
  if (layer === "Buildings") occ.push(...faceOcc);
}

function terrainIndices(count: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) out.push(i);
  if (out[out.length - 1] !== count - 1) out.push(count - 1);
  return out;
}

function shadeHeight(t: number): Rgb {
  const u = Math.min(1, Math.max(0, t));
  return [0.718 + (0.953 - 0.718) * u, 0.655 + (0.925 - 0.655) * u, 0.576 + (0.898 - 0.576) * u];
}

function collect(
  model: CityModel,
  shot: CameraShot,
  style: ViewStyle,
  pageW: number,
  pageH: number,
): { fills: Fill[]; edges: Edge[]; trees: Fill[] } {
  const forward = shot.forward;
  const half = model.sideM / 2;
  const groundFill = fillOf("--ground-fill");
  const greenFill = fillOf("--green-3d");
  const waterFill = fillOf("--water-3d");
  const crownFill = fillOf("--tree-crown");
  const crownEdge = fillOf("--tree-crown-edge");
  const trunkFill = fillOf("--tree-trunk");
  const field = model.terrain;
  const sample = field ? (east: number, north: number) => sampleTerrain(field, east, north, model.sideM) : null;
  const fills: Fill[] = [];
  const edges: Edge[] = [];
  const occ: Occ[] = [];
  let nextId = 1;

  if (field) {
    const cells = (field.cols - 1) * (field.rows - 1);
    const stride = Math.max(1, Math.ceil(Math.sqrt(cells / 1600)));
    const cols = terrainIndices(field.cols, stride);
    const rows = terrainIndices(field.rows, stride);
    const relief = Math.max(field.max - field.min, 0.001);
    const at = (col: number, row: number): Vec3 => {
      const east = -half + col * field.spacingM;
      const north = -half + row * field.spacingM;
      const y = field.heights[row * field.cols + col];
      return [east, y, -north];
    };
    const tint = (col: number, row: number): Rgb => shadeHeight((field.heights[row * field.cols + col] - field.min) / relief);
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < cols.length - 1; c++) {
        const sw = at(cols[c], rows[r]);
        const se = at(cols[c + 1], rows[r]);
        const nw = at(cols[c], rows[r + 1]);
        const ne = at(cols[c + 1], rows[r + 1]);
        const csw = tint(cols[c], rows[r]);
        const cse = tint(cols[c + 1], rows[r]);
        const cnw = tint(cols[c], rows[r + 1]);
        const cne = tint(cols[c + 1], rows[r + 1]);
        const mix = (a: Rgb, b: Rgb, d: Rgb): Rgb => [
          (a[0] + b[0] + d[0]) / 3,
          (a[1] + b[1] + d[1]) / 3,
          (a[2] + b[2] + d[2]) / 3,
        ];
        pushTri(fills, edges, occ, nextId++, faceUp([sw, se, ne]), mix(csw, cse, cne), "Ground", 0, false, shot, pageW, pageH, forward);
        pushTri(fills, edges, occ, nextId++, faceUp([sw, ne, nw]), mix(csw, cne, cnw), "Ground", 0, false, shot, pageW, pageH, forward);
      }
    }
  } else {
    const y = 0;
    pushTri(
      fills,
      edges,
      occ,
      nextId++,
      faceUp([
        worldOf(-half, -half, y),
        worldOf(half, -half, y),
        worldOf(half, half, y),
        worldOf(-half, half, y),
      ]),
      groundFill,
      "Ground",
      0,
      false,
      shot,
      pageW,
      pageH,
      forward,
    );
  }

  const areaY = (ring: Pt[], lift: number) => {
    if (!sample) return lift;
    let sum = 0;
    const points = openRing(ring);
    for (const point of points) sum += sample(point[0], point[1]);
    return (points.length > 0 ? sum / points.length : 0) + lift;
  };

  model.areas.forEach((area, index) => {
    const lift = (area.kind === "water" ? SURFACE.water.lift : SURFACE.green.lift) + (index % 4) * 0.008;
    const color = area.kind === "water" ? waterFill : greenFill;
    const layer = area.kind === "water" ? "Water" : "Green";
    const rank = area.kind === "water" ? 2 : 3;
    if (!sample) {
      const y = lift;
      const loops = [orient(area.ring, true), ...area.holes.map((hole) => orient(hole, false))]
        .map((ring) => ring.map((point) => worldOf(point[0], point[1], y)));
      const outer = loops[0];
      if (!outer || outer.length < 3) return;
      // Fan the outer ring; holes are drawn with even-odd by emitting the full loops as one path below.
      const projected = loops.map((loop) => loop.map((corner) => project(shot, corner, pageW, pageH)));
      if (projected.some((loop) => loop.some((point) => point === null))) return;
      const poly = projected as V2[][];
      const depth = poly[0].reduce((sum, point) => sum + point.z, 0) / poly[0].length;
      fills.push({
        depth,
        rank,
        occ: [],
        chunk: {
          name: layer,
          paths: [
            {
              rings: poly.map((loop) => loop.map((point) => [point.x, point.y])),
              fill: lit(color, [0, 1, 0], 0.3),
              evenOdd: true,
              close: true,
            },
          ],
        },
      });
      return;
    }
    const y = areaY(area.ring, lift);
    for (const tri of shapeTriangles(area.ring, area.holes, () => y)) {
      pushTri(fills, edges, occ, nextId++, faceUp(tri), color, layer, rank, false, shot, pageW, pageH, forward);
    }
  });

  const maxStep = field ? 40 : 1e9;
  for (const road of model.roads) {
    if (road.kind === "rail") continue;
    const grade = road.grade ?? "local";
    const color = hexRgb(ROAD_COLOR[grade]);
    const lift = grade === "arterial" ? SURFACE.arterial.lift : grade === "path" ? SURFACE.path.lift : SURFACE.local.lift;
    const line = openRing(road.line);
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.2) continue;
      const steps = Math.max(1, Math.min(8, Math.ceil(length / maxStep)));
      for (let step = 0; step < steps; step++) {
        const t0 = step / steps;
        const t1 = (step + 1) / steps;
        const p: Pt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const q: Pt = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const span = Math.hypot(dx, dy);
        if (span < 0.2) continue;
        const px = (-dy / span) * (Math.max(road.width, 1.6) / 2);
        const py = (dx / span) * (Math.max(road.width, 1.6) / 2);
        const y = (east: number, north: number) => (sample ? sample(east, north) : 0) + lift;
        const aL = worldOf(p[0] + px, p[1] + py, y(p[0] + px, p[1] + py));
        const aR = worldOf(p[0] - px, p[1] - py, y(p[0] - px, p[1] - py));
        const bL = worldOf(q[0] + px, q[1] + py, y(q[0] + px, q[1] + py));
        const bR = worldOf(q[0] - px, q[1] - py, y(q[0] - px, q[1] - py));
        pushTri(fills, edges, occ, nextId++, faceUp([aL, bL, bR]), color, "Roads", 1, false, shot, pageW, pageH, forward);
        pushTri(fills, edges, occ, nextId++, faceUp([aL, bR, aR]), color, "Roads", 1, false, shot, pageW, pageH, forward);
      }
    }
  }

  for (const building of model.buildings) {
    const base = (field ? footprintBase(field, building.ring, model.sideM) : 0) + SURFACE.building.lift;
    const top = base + Math.max(building.height, 0.5);
    const color = buildingColor(building, style);
    const shell = [building.ring, ...building.holes];
    for (const ring of shell) {
      const ccw = ring === building.ring;
      const points = orient(ring, ccw);
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.25) continue;
        const id = nextId++;
        pushTri(
          fills,
          edges,
          occ,
          id,
          [worldOf(a[0], a[1], base), worldOf(b[0], b[1], base), worldOf(b[0], b[1], top), worldOf(a[0], a[1], top)],
          color,
          "Buildings",
          4,
          true,
          shot,
          pageW,
          pageH,
          forward,
        );
      }
    }
    const roofId = nextId++;
    const roofLoops = [orient(building.ring, true), ...building.holes.map((hole) => orient(hole, false))];
    for (const loop of roofLoops) {
      if (loop.length < 3) continue;
      const projected = loop.map((point) => project(shot, worldOf(point[0], point[1], top), pageW, pageH));
      if (projected.some((point) => point === null)) continue;
      const poly = projected as V2[];
      if (!facesCamera([0, 1, 0], forward)) continue;
      for (let i = 0; i < poly.length; i++) edges.push({ a: poly[i], b: poly[(i + 1) % poly.length], id: roofId });
    }
    for (const tri of shapeTriangles(building.ring, building.holes, () => top)) {
      pushTri(fills, edges, occ, roofId, faceUp(tri), color, "Buildings", 4, false, shot, pageW, pageH, forward);
    }
  }

  const trees: Fill[] = [];
  for (const tree of model.trees) {
    const east = tree.at[0];
    const north = tree.at[1];
    const groundY = sample ? sample(east, north) : 0;
    const radius = Math.max(tree.crown_diameter_m / 2, 0.4);
    const mid = groundY + tree.height_m * 0.45;
    const centre = project(shot, worldOf(east, north, mid), pageW, pageH);
    const eastPoint = project(shot, worldOf(east + radius, north, mid), pageW, pageH);
    const northPoint = project(shot, worldOf(east, north + radius, mid), pageW, pageH);
    if (!centre || !eastPoint || !northPoint) continue;
    const rx = Math.max(0.15, Math.hypot(eastPoint.x - centre.x, eastPoint.y - centre.y));
    const ry = Math.max(0.15, Math.hypot(northPoint.x - centre.x, northPoint.y - centre.y));
    const base = project(shot, worldOf(east, north, groundY), pageW, pageH);
    const trunk = project(shot, worldOf(east, north, groundY + Math.min(tree.height_m * 0.34, radius * 1.4)), pageW, pageH);
    const paths =
      base && trunk
        ? [
            {
              rings: [[[base.x, base.y], [trunk.x, trunk.y]]],
              close: false,
              stroke: trunkFill,
              strokeMm: 0.22,
              cap: "round" as const,
            },
          ]
        : [];
    trees.push({
      depth: centre.z,
      rank: 5,
      occ: [],
      chunk: {
        name: "Trees",
        paths,
        ellipses: [
          {
            kind: "ellipse",
            cx: centre.x,
            cy: centre.y,
            rx,
            ry,
            fill: crownFill,
            stroke: crownEdge,
            strokeMm: 0.12,
          },
        ],
      },
    });
  }

  return { fills, edges, trees };
}

export function viewChunks(model: CityModel, shot: CameraShot, style: ViewStyle): PdfChunk[] {
  const page = viewPageMm(shot.width, shot.height);
  const ink = fillOf("--view-ink");
  const backdrop = fillOf("--export-backdrop");
  const { fills, edges, trees } = collect(model, shot, style, page.widthMm, page.heightMm);
  const ordered = [...fills, ...trees].sort((a, b) => b.depth - a.depth || a.rank - b.rank);
  const occ = fills.flatMap((fill) => fill.occ);
  const cells = gridIndex(occ, page.widthMm, page.heightMm);
  const seen = new Set<string>();
  const outlinePaths: PdfChunk["paths"] = [];
  for (const edge of edges) {
    const key = edgeKey(edge.a, edge.b);
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = clipEdge(edge.a, edge.b, candidates(cells, edge.a, edge.b, page.widthMm, page.heightMm), edge.id);
    for (const [a, b] of parts) {
      outlinePaths.push({
        rings: [[[a.x, a.y], [b.x, b.y]]],
        close: false,
        stroke: ink,
        strokeMm: VIEW_OUTLINE_MM,
        cap: "round",
        join: "round",
      });
    }
  }

  const chunks: PdfChunk[] = [
    {
      name: "Ground",
      paths: [
        {
          rings: [[[0, 0], [page.widthMm, 0], [page.widthMm, page.heightMm], [0, page.heightMm]]],
          fill: backdrop,
          close: true,
          evenOdd: false,
        },
      ],
    },
  ];
  for (const fill of ordered) chunks.push(fill.chunk);
  if (outlinePaths.length > 0) chunks.push({ name: "Outlines", paths: outlinePaths });
  const label = `${model.placeLabel} · ${formatPair(model)}`;
  const comCredit = comBuildingHeightCreditLine(model);
  const plate = Math.min(page.widthMm - 8, Math.max(42, label.length * 1.35 + 8));
  const boxHeight = comCredit ? 18.4 : 12.4;
  const texts: PdfChunk["texts"] = [
    { x: 4.2, y: boxHeight - 4, sizeMm: 2.6, text: label, color: ink },
    { x: 4.2, y: 4.2, sizeMm: 2.8, text: "not to scale", color: ink },
  ];
  if (comCredit) {
    texts.splice(1, 0, { x: 4.2, y: 8.8, sizeMm: 1.85, text: comCredit, color: ink });
  }
  chunks.push({
    name: "Annotation",
    paths: [
      {
        rings: [[[3, 2.4], [3 + plate, 2.4], [3 + plate, 2.4 + boxHeight], [3, 2.4 + boxHeight]]],
        fill: [0.98, 0.97, 0.95],
        stroke: ink,
        strokeMm: 0.13,
        close: true,
        evenOdd: false,
      },
    ],
    texts,
  });
  return chunks;
}

function formatPair(model: CityModel): string {
  return `${formatCoord(model.center.lat)}, ${formatCoord(model.center.lon)}`;
}

function edgeKey(a: V2, b: V2): string {
  const q = (value: number) => Math.round(value * 20);
  const left = `${q(a.x)},${q(a.y)}`;
  const right = `${q(b.x)},${q(b.y)}`;
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

export async function viewAi(model: CityModel, shot: CameraShot, style: ViewStyle): Promise<Uint8Array> {
  const page = viewPageMm(shot.width, shot.height);
  const title = `${model.placeLabel} · 3D view · ${formatCoord(model.center.lat)}, ${formatCoord(model.center.lon)}`;
  const chunks = viewChunks(model, shot, style);
  if (useNativeAi8Export()) {
    return buildLayeredNativeAi(page.widthMm, page.heightMm, chunks, VIEW_LAYER_ORDER, title);
  }
  if (import.meta.env.VITE_CITYCUT_AI_PDF_OPS === "true") {
    return buildLayeredNativeAiPdfOps(page.widthMm, page.heightMm, chunks, VIEW_LAYER_ORDER, title);
  }
  return buildLayeredPdf(page.widthMm, page.heightMm, chunks, VIEW_LAYER_ORDER);
}
