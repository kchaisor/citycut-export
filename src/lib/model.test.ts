import { describe, expect, it } from "vitest";
import { buildCityGroup, disposeObject } from "./buildCity";
import { clipPolygon, clipSegment } from "./clip";
import { fromLocal, squareBBox, toLocal } from "./geo";
import { buildingHeight } from "./height";
import { parseCity, stitchRings } from "./parseOsm";
import { sitePlanSvg } from "./svgPlan";
import type { CityModel, Pt } from "../types";

const origin = { lon: 144.9631, lat: -37.8136 };

function square(center: Pt, size: number): Pt[] {
  const h = size / 2;
  const ring: Pt[] = [
    [center[0] - h, center[1] - h],
    [center[0] + h, center[1] - h],
    [center[0] + h, center[1] + h],
    [center[0] - h, center[1] + h],
    [center[0] - h, center[1] - h],
  ];
  return ring;
}

function geom(points: Pt[]) {
  return points.map((point) => fromLocal(point, origin));
}

describe("heights", () => {
  it("prefers the height tag, then levels, then 9 m", () => {
    expect(buildingHeight({ height: "24.5" })).toBe(24.5);
    expect(buildingHeight({ height: "30 ft" })).toBeCloseTo(9.144, 2);
    expect(buildingHeight({ "building:levels": "4" })).toBe(12);
    expect(buildingHeight({ building: "yes" })).toBe(9);
  });
});

describe("clip", () => {
  it("keeps an inside segment and cuts one that crosses the square", () => {
    expect(clipSegment([0, 0], [10, 0], -20, 20)).not.toBeNull();
    const cut = clipSegment([-40, 0], [40, 0], -10, 10);
    expect(cut?.[0][0]).toBeCloseTo(-10);
    expect(cut?.[1][0]).toBeCloseTo(10);
  });

  it("clips a polygon to the cut square", () => {
    const clipped = clipPolygon(square([0, 0], 100), -10, 10);
    expect(clipped.length).toBeGreaterThanOrEqual(4);
    for (const [x, y] of clipped) {
      expect(x).toBeGreaterThanOrEqual(-10.01);
      expect(x).toBeLessThanOrEqual(10.01);
      expect(y).toBeGreaterThanOrEqual(-10.01);
      expect(y).toBeLessThanOrEqual(10.01);
    }
  });
});

describe("parse", () => {
  it("stitches a split outer ring", () => {
    const rings = stitchRings([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      [
        [0, 8],
        [0, 0],
      ],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0][0][0]).toBeCloseTo(rings[0][rings[0].length - 1][0]);
  });

  it("builds buildings, roads, and parks inside the frame", () => {
    const footprint = geom(square([20, 30], 40));
    const park = geom(square([-80, -40], 50));
    const road = geom([
      [-400, 0],
      [400, 0],
    ]);
    const parsed = parseCity(
      {
        elements: [
          {
            type: "way",
            id: 1,
            tags: { building: "yes", height: "18" },
            geometry: footprint,
          },
          {
            type: "way",
            id: 2,
            tags: { leisure: "park" },
            geometry: park,
          },
          {
            type: "way",
            id: 3,
            tags: { highway: "residential" },
            geometry: road,
          },
          {
            type: "way",
            id: 4,
            tags: { building: "yes", "building:levels": "2" },
            geometry: geom(square([5000, 5000], 30)),
          },
        ],
      },
      origin,
      400,
      { buildings: true, roads: true, waterGreen: true, trees: false },
    );

    expect(parsed.buildings).toHaveLength(1);
    expect(parsed.buildings[0].height).toBe(18);
    expect(parsed.areas).toHaveLength(1);
    expect(parsed.areas[0].kind).toBe("green");
    expect(parsed.roads).toHaveLength(1);
    expect(parsed.roadKm).toBeGreaterThan(0.3);
    expect(parsed.roadKm).toBeLessThan(0.5);
    const back = toLocal(parsed.center.lat, parsed.center.lon, origin);
    expect(back[0]).toBeCloseTo(0);
    expect(back[1]).toBeCloseTo(0);
  });

  it("reads a multipolygon water relation", () => {
    const west = geom([
      [-30, -20],
      [0, -20],
    ]);
    const east = geom([
      [0, -20],
      [30, -20],
      [30, 20],
      [-30, 20],
      [-30, -20],
    ]);
    const parsed = parseCity(
      {
        elements: [
          {
            type: "relation",
            id: 9,
            tags: { natural: "water", type: "multipolygon" },
            members: [
              { type: "way", ref: 11, role: "outer", geometry: west },
              { type: "way", ref: 12, role: "outer", geometry: east },
            ],
          },
        ],
      },
      origin,
      200,
      { buildings: false, roads: false, waterGreen: true, trees: false },
    );
    expect(parsed.areas).toHaveLength(1);
    expect(parsed.areas[0].kind).toBe("water");
  });
});

describe("exports", () => {
  const model: CityModel = {
    placeLabel: "Test",
    center: origin,
    sideM: 200,
    layers: { buildings: true, roads: true, waterGreen: true, trees: false },
    buildings: [{ id: 1, ring: square([0, 0], 40), holes: [], height: 12 }],
    roads: [{ id: 2, line: [[-80, 10], [80, 10]], width: 6, kind: "road" }],
    areas: [{ id: 3, ring: square([-40, -40], 30), holes: [], kind: "green" }],
    trees: [],
    roadKm: 0.16,
    buildingCapHit: false,
    sourceNote: "test",
  };

  it("writes an svg plan with building and road geometry", () => {
    const svg = sitePlanSvg(model);
    expect(svg).toContain("<path");
    expect(svg).toContain("OpenStreetMap");
    expect(svg).toContain("evenodd");
  });

  it("extrudes a building mesh above the ground", () => {
    const group = buildCityGroup(model);
    const buildings = group.getObjectByName("Buildings");
    const roads = group.getObjectByName("Roads");
    expect(buildings).toBeTruthy();
    expect(roads).toBeTruthy();
    buildings!.updateWorldMatrix(true, true);
    const position = (buildings as { geometry?: { attributes?: { position?: { count: number } } } }).geometry;
    expect(position?.attributes?.position?.count).toBeGreaterThan(0);
    const bbox = squareBBox(origin, 200);
    expect(bbox.north).toBeGreaterThan(origin.lat);
    expect(bbox.east).toBeGreaterThan(origin.lon);
    disposeObject(group);
  });
});
