import { describe, expect, it } from "vitest";
import { mgaCrs, mgaZone, projectLocal, projectLonLat } from "./crs";

describe("MGA zone", () => {
  it("puts Melbourne in zone 55 and longitudes west of 144°E in zone 54", () => {
    expect(mgaZone(144.9631)).toBe(55);
    expect(mgaCrs(144.9631)).toMatchObject({ zone: 55, epsg: 7855 });
    expect(mgaZone(144)).toBe(55);
    expect(mgaZone(143.999)).toBe(54);
    expect(mgaCrs(143.5)).toMatchObject({ zone: 54, epsg: 7854 });
    expect(mgaCrs(150)).toMatchObject({ zone: 56, epsg: 7856 });
  });

  it("does not invent an EPSG code outside the GDA2020 MGA zones", () => {
    expect(mgaCrs(0).epsg).toBeNull();
    expect(mgaCrs(0).zone).toBe(31);
  });
});

describe("MGA projection", () => {
  it("lands the zone 55 central meridian on easting 500000", () => {
    const [easting, northing] = projectLonLat(147, -37.8136, 55);
    expect(easting).toBeCloseTo(500_000, 3);
    expect(northing).toBeLessThan(10_000_000);
    expect(northing).toBeGreaterThan(5_000_000);
  });

  it("projects the Melbourne cut centre into zone 55 metres", () => {
    const origin = { lon: 144.9631, lat: -37.8136 };
    const [easting, northing] = projectLocal([0, 0], origin, 55);
    expect(easting).toBeCloseTo(320_704.446, 2);
    expect(northing).toBeCloseTo(5_812_911.7, 1);
    expect(projectLonLat(origin.lon, origin.lat, 55)).toEqual([easting, northing]);
  });
});
