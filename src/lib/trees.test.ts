import { describe, expect, it } from "vitest";

if (typeof globalThis.FileReader === "undefined") {
  class FileReaderPolyfill {
    result: ArrayBuffer | string | null = null;
    onloadend: null | (() => void) = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  }
  globalThis.FileReader = FileReaderPolyfill as unknown as typeof FileReader;
}
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import * as THREE from "three";
import { buildCityGroup, disposeObject } from "./buildCity";
import { fromLocal } from "./geo";
import { buildOverpassQuery, overpassBBox } from "./overpass";
import { parseCity } from "./parseOsm";
import { sitePlanSvg } from "./svgPlan";
import { DEFAULT_CROWN_DIAMETER, DEFAULT_TREE_HEIGHT, treeSize } from "./trees";
import type { CityModel, Pt } from "../types";

const origin = { lon: 144.9631, lat: -37.8136 };
const layersOn = { buildings: false, roads: false, waterGreen: false, trees: true };
const bbox = overpassBBox({ south: -37.82, west: 144.95, north: -37.8, east: 144.98 });

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

function geom(points: Pt[]) {
  return points.map((point) => fromLocal(point, origin));
}

describe("tree size", () => {
  it("uses height and crown tags when they are present", () => {
    expect(treeSize({ height: "18", diameter_crown: "8" })).toEqual({
      height: 18,
      crownDiameter: 8,
    });
    expect(treeSize({ height: "12", crown_diameter: "7.5" })).toEqual({
      height: 12,
      crownDiameter: 7.5,
    });
    expect(treeSize({ height: "30 ft", "diameter:crown": "20 ft" })).toEqual({
      height: 9.144,
      crownDiameter: 6.096,
    });
  });

  it("fills the missing dimension from the one that is tagged", () => {
    expect(treeSize({ height: "20" })).toEqual({ height: 20, crownDiameter: 12 });
    expect(treeSize({ crown_diameter: "9" })).toEqual({ height: 15, crownDiameter: 9 });
  });

  it("uses Melbourne street-tree defaults when size tags are missing", () => {
    expect(treeSize({})).toEqual({
      height: DEFAULT_TREE_HEIGHT,
      crownDiameter: DEFAULT_CROWN_DIAMETER,
    });
    expect(treeSize({ natural: "tree", species: "Platanus × hispanica" })).toEqual({
      height: DEFAULT_TREE_HEIGHT,
      crownDiameter: DEFAULT_CROWN_DIAMETER,
    });
  });

  it("clamps absurd tags", () => {
    expect(treeSize({ height: "400", diameter_crown: "0.2" })).toEqual({
      height: 50,
      crownDiameter: 1.5,
    });
  });
});

describe("tree parse", () => {
  it("keeps a tagged tree inside the frame and drops one outside", () => {
    const inside = fromLocal([25, -15], origin);
    const outside = fromLocal([300, 0], origin);
    const parsed = parseCity(
      {
        elements: [
          {
            type: "node",
            id: 7,
            lat: inside.lat,
            lon: inside.lon,
            tags: { natural: "tree", height: "16", diameter_crown: "9", species: "Corymbia maculata" },
          },
          {
            type: "node",
            id: 8,
            lat: outside.lat,
            lon: outside.lon,
            tags: { natural: "tree", height: "12" },
          },
        ],
      },
      origin,
      200,
      layersOn,
    );
    expect(parsed.trees).toHaveLength(1);
    expect(parsed.trees[0].at[0]).toBeCloseTo(25);
    expect(parsed.trees[0].at[1]).toBeCloseTo(-15);
    expect(parsed.trees[0].height).toBe(16);
    expect(parsed.trees[0].crownDiameter).toBe(9);
    expect(parsed.trees[0].species).toBe("Corymbia maculata");
    expect(parsed.trees[0].archetype).toBe("gum-open");
  });

  it("defaults an untagged tree", () => {
    const at = fromLocal([0, 0], origin);
    const parsed = parseCity(
      {
        elements: [
          { type: "node", id: 1, lat: at.lat, lon: at.lon, tags: { natural: "tree" } },
        ],
      },
      origin,
      200,
      layersOn,
    );
    expect(parsed.trees[0].height).toBe(DEFAULT_TREE_HEIGHT);
    expect(parsed.trees[0].crownDiameter).toBe(DEFAULT_CROWN_DIAMETER);
    expect(parsed.trees[0].archetype).toBe("generic");
    expect(parsed.sourceNote).toContain("10 m tall");
  });

  it("ignores trees when the layer is off", () => {
    const at = fromLocal([0, 0], origin);
    const parsed = parseCity(
      {
        elements: [
          { type: "node", id: 1, lat: at.lat, lon: at.lon, tags: { natural: "tree", height: "20" } },
        ],
      },
      origin,
      200,
      { buildings: true, roads: true, waterGreen: true, trees: false },
    );
    expect(parsed.trees).toEqual([]);
  });

  it("places a closed tree area at its centre and samples a tree row", () => {
    const parsed = parseCity(
      {
        elements: [
          {
            type: "way",
            id: 3,
            tags: { natural: "tree", height: "14", diameter_crown: "10" },
            geometry: geom(square([20, 30], 12)),
          },
          {
            type: "way",
            id: 4,
            tags: { natural: "tree_row", diameter_crown: "8" },
            geometry: geom([
              [-80, 10],
              [80, 10],
            ]),
          },
        ],
      },
      origin,
      200,
      layersOn,
    );
    const area = parsed.trees.find((tree) => tree.id === 3);
    expect(area?.at[0]).toBeCloseTo(20);
    expect(area?.at[1]).toBeCloseTo(30);
    expect(area?.height).toBe(14);
    const row = parsed.trees.filter((tree) => tree.id === 4);
    expect(row.length).toBeGreaterThan(10);
    expect(row[0].at[0]).toBeCloseTo(-80);
    expect(row[0].at[1]).toBeCloseTo(10);
    expect(row.every((tree) => Math.abs(tree.at[0]) <= 100.2 && Math.abs(tree.at[1] - 10) < 0.05)).toBe(
      true,
    );
    expect(row[0].crownDiameter).toBe(8);
  });

  it("caps a very large tree set", () => {
    const at = fromLocal([0, 0], origin);
    const elements = Array.from({ length: 6001 }, (_, index) => ({
      type: "node" as const,
      id: index + 1,
      lat: at.lat,
      lon: at.lon,
      tags: { natural: "tree" },
    }));
    const parsed = parseCity({ elements }, origin, 200, layersOn);
    expect(parsed.trees).toHaveLength(6000);
    expect(parsed.sourceNote).toContain("capped at 6000");
  });
});

describe("tree query", () => {
  it("asks Overpass for trees only when the layer is on", () => {
    const on = buildOverpassQuery(bbox, layersOn);
    expect(on).toContain('node["natural"="tree"]');
    expect(on).toContain('way["natural"="tree_row"]');
    expect(on).not.toContain("highway");
    const off = buildOverpassQuery(bbox, {
      buildings: true,
      roads: false,
      waterGreen: false,
      trees: false,
    });
    expect(off).not.toContain('natural"="tree"');
    expect(() =>
      buildOverpassQuery(bbox, { buildings: false, roads: false, waterGreen: false, trees: false }),
    ).toThrow(/Trees/);
  });
});

describe("tree exports", () => {
  const model: CityModel = {
    placeLabel: "Test",
    center: origin,
    sideM: 200,
    layers: { buildings: false, roads: false, waterGreen: false, trees: true },
    buildings: [],
    roads: [],
    areas: [],
    trees: [{ id: 9, at: [20, 30], height: 14, crownDiameter: 8 }],
    roadKm: 0,
    buildingCapHit: false,
    sourceNote: "test",
  };

  it("draws a plan circle for each tree", () => {
    const svg = sitePlanSvg(model);
    expect(svg).toContain("<circle");
    expect(svg).toContain('cx="20"');
    expect(svg).toContain('cy="-30"');
    expect(svg).toContain('r="4"');
  });

  it("instances one archetype and scales it to the tree height and crown", () => {
    const group = buildCityGroup(model);
    const trees = group.getObjectByName("Trees");
    expect(trees).toBeTruthy();
    group.updateMatrixWorld(true);
    const meshes: THREE.InstancedMesh[] = [];
    trees!.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (mesh.isInstancedMesh) meshes.push(mesh);
    });
    expect(meshes).toHaveLength(1);
    expect(meshes[0].count).toBe(1);
    expect(meshes[0].userData.archetype).toBe("generic");
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    meshes[0].getMatrixAt(0, matrix);
    matrix.decompose(position, quaternion, scale);
    expect(position.x).toBeCloseTo(20);
    expect(position.z).toBeCloseTo(-30);
    expect(scale.y).toBeCloseTo(14);
    expect(scale.x).toBeCloseTo(8);
    expect(scale.z).toBeCloseTo(8);
    matrix.premultiply(meshes[0].matrixWorld);
    const vertex = new THREE.Vector3();
    const attribute = meshes[0].geometry.getAttribute("position");
    let tip = false;
    let wideCrown = false;
    for (let i = 0; i < attribute.count; i++) {
      vertex.fromBufferAttribute(attribute, i).applyMatrix4(matrix);
      const radial = Math.hypot(vertex.x - 20, vertex.z + 30);
      if (Math.abs(vertex.y - 14) < 0.05 && radial < 0.05) tip = true;
      if (radial > 3.2 && radial < 4.3 && vertex.y > 8 && vertex.y < 12.5) wideCrown = true;
    }
    expect(tip).toBe(true);
    expect(wideCrown).toBe(true);
    disposeObject(group);
  });

  it("omits the tree mesh when the cut has no trees", () => {
    const group = buildCityGroup({ ...model, trees: [] });
    expect(group.getObjectByName("Trees")).toBeUndefined();
    disposeObject(group);
  });

  it("includes the tree mesh in the binary glTF", async () => {
    const group = buildCityGroup(model);
    try {
      const exporter = new GLTFExporter();
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          group,
          (result) => {
            if (result instanceof ArrayBuffer) resolve(result);
            else reject(new Error("expected binary glTF"));
          },
          (error) => reject(error),
          { binary: true },
        );
      });
      const text = new TextDecoder().decode(buffer);
      expect(text).toContain("Trees");
      expect(text).toContain("EXT_mesh_gpu_instancing");
      expect(text).toContain("generic");
    } finally {
      disposeObject(group);
    }
  });
});
