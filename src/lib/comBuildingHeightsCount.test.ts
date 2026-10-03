import { describe, expect, it } from "vitest";
import { buildingHasComDerivedExtrusion, countBuildingsWithComDerivedExtrusion } from "./comBuildingHeightsCount";
import type { BuildingFeat } from "../types";

function building(id: number, height: number, extrusionParts?: BuildingFeat["extrusionParts"]): BuildingFeat {
  return {
    id,
    ring: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [],
    height,
    use: "unclassified",
    source: "none",
    extrusionParts,
  };
}

describe("comBuildingHeightsCount", () => {
  it("counts buildings with CoM-derived extrusion parts", () => {
    const before = [building(1, 9), building(2, 12)];
    const after = [
      building(1, 9),
      building(2, 12, [{ ring: before[1].ring, holes: [], height: 24 }]),
    ];
    expect(countBuildingsWithComDerivedExtrusion(before, after)).toBe(1);
    expect(buildingHasComDerivedExtrusion(before[1], after[1])).toBe(true);
  });

  it("counts single-part fast-path height changes", () => {
    const before = building(3, 9);
    const after = { ...before, height: 20 };
    expect(buildingHasComDerivedExtrusion(before, after)).toBe(true);
  });
});
