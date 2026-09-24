import { describe, expect, it } from "vitest";
import { projectLocal } from "./crs";
import { cityModelTo3dm, loadRhino } from "./rhinoExport";
import type { CityModel, Pt } from "../types";

const origin = { lon: 144.9631, lat: -37.8136 };

function square(center: Pt, size: number): Pt[] {
  const h = size / 2;
  return [
    [center[0] - h, center[1] - h],
    [center[0] + h, center[1] - h],
    [center[0] + h, center[1] + h],
    [center[0] - h, center[1] + h],
    [center[0] - h, center[1] - h],
  ];
}

const model: CityModel = {
  placeLabel: "Test",
  center: origin,
  sideM: 200,
  layers: { buildings: true, roads: true, waterGreen: true },
  buildings: [{ id: 1, ring: square([0, 0], 40), holes: [], height: 12 }],
  roads: [{ id: 2, line: [[-80, 10], [80, 10]], width: 6, kind: "road" }],
  areas: [{ id: 3, ring: square([-40, -40], 30), holes: [], kind: "green" }],
  roadKm: 0.16,
  buildingCapHit: false,
  sourceNote: "test",
};

type ReadMesh = {
  vertices: () => { count: number; point3dAt: (index: number) => number[] };
  faces: () => { count: number };
};

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

describe("rhino export", () => {
  it("writes a Z-up .3dm in MGA zone 55 metres", async () => {
    const bytes = await cityModelTo3dm(model);
    const header = latin1(bytes);
    expect(header.startsWith("3D Geometry File Format")).toBe(true);
    expect(header).toContain("EPSG:7855");
    expect(header).toContain("datum shift");

    const rhino = await loadRhino();
    const doc = rhino.File3dm.fromByteArray(bytes);
    try {
      expect(doc.settings().modelUnitSystem).toBe(rhino.UnitSystem.Meters);
      const anchor = doc.settings().earthAnchorPoint;
      const [easting, northing] = projectLocal([0, 0], origin, 55);
      expect(anchor.earthBasepointLatitude).toBeCloseTo(origin.lat, 5);
      expect(anchor.earthBasepointLongitude).toBeCloseTo(origin.lon, 5);
      expect(anchor.modelBasePoint[0]).toBeCloseTo(easting, 2);
      expect(anchor.modelBasePoint[1]).toBeCloseTo(northing, 2);
      expect(anchor.modelBasePoint[2]).toBeCloseTo(0, 5);
      expect(anchor.modelEast[0]).toBeCloseTo(1);
      expect(anchor.modelNorth[1]).toBeCloseTo(1);
      expect(doc.objects().count).toBeGreaterThanOrEqual(4);

      const names: string[] = [];
      const points: number[][] = [];
      for (let i = 0; i < doc.objects().count; i++) {
        const object = doc.objects().get(i);
        names.push(object.attributes().name);
        const geometry = object.geometry() as unknown as ReadMesh;
        expect(geometry.faces().count).toBeGreaterThan(0);
        for (let v = 0; v < geometry.vertices().count; v++) {
          points.push(geometry.vertices().point3dAt(v));
        }
      }
      expect(names).toEqual(expect.arrayContaining(["Buildings", "Roads", "Green", "Ground"]));

      const top = projectLocal([20, 20], origin, 55);
      const south = projectLocal([20, -20], origin, 55);
      const hasTop = points.some(
        (point) => Math.hypot(point[0] - top[0], point[1] - top[1]) < 0.05 && Math.abs(point[2] - 12) < 0.05,
      );
      const hasSouth = points.some(
        (point) =>
          Math.hypot(point[0] - south[0], point[1] - south[1]) < 0.05 && Math.abs(point[2] - 12) < 0.05,
      );
      expect(hasTop).toBe(true);
      expect(hasSouth).toBe(true);
      expect(top[1]).toBeGreaterThan(south[1]);
    } finally {
      doc.destroy();
    }
  });

  it("labels a western block as MGA zone 54", async () => {
    const bytes = await cityModelTo3dm({
      ...model,
      center: { lon: 143.5, lat: -37.8136 },
    });
    expect(latin1(bytes)).toContain("EPSG:7854");
  });
});
