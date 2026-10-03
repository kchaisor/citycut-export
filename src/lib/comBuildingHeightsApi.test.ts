import { describe, expect, it } from "vitest";
import { comRecordsWhereIntersects, paddedComFetchBounds } from "./comBuildingHeightsApi";

describe("comBuildingHeightsApi", () => {
  it("builds an intersects(geo_shape) where clause for a padded frame", () => {
    const bounds = paddedComFetchBounds({ lon: 144.9631, lat: -37.8136 }, 1000);
    const where = comRecordsWhereIntersects(bounds);
    expect(where).toMatch(/^intersects\(geo_shape, geom'POLYGON\(\(/);
    expect(where).toContain(`${bounds.west}`);
    expect(where).toContain(`${bounds.east}`);
    expect(where.endsWith("))')")).toBe(true);
  });

  it("expands the fetch bounds beyond the cut square by the buffer", () => {
    const center = { lon: 144.9631, lat: -37.8136 };
    const tight = paddedComFetchBounds(center, 1000);
    const wide = paddedComFetchBounds(center, 1000 + 40);
    expect(wide.north - wide.south).toBeGreaterThan(tight.north - tight.south);
  });
});
