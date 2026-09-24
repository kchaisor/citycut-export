import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildCityGroup, disposeObject } from "./buildCity";
import { ARCHETYPE_CATALOG, archetypeGltf, isArchetypeId } from "./treeForms";
import { archetypeGeometry } from "./treeArchetypes";
import { mappedArchetypeIds, resolveArchetype } from "./treeMap";
import type { CityModel } from "../types";

const gltfSources = import.meta.glob("../assets/trees/*.gltf", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("tree archetype library", () => {
  it("ships a small curated set of unit-height forms", () => {
    expect(ARCHETYPE_CATALOG.length).toBeGreaterThanOrEqual(15);
    expect(ARCHETYPE_CATALOG.length).toBeLessThanOrEqual(40);
    expect(new Set(ARCHETYPE_CATALOG.map((item) => item.id)).size).toBe(ARCHETYPE_CATALOG.length);
  });

  it("keeps the glTF files in step with the form builder", () => {
    for (const info of ARCHETYPE_CATALOG) {
      const source = Object.entries(gltfSources).find(([path]) => path.endsWith(`/${info.id}.gltf`))?.[1];
      expect(source, info.id).toBe(archetypeGltf(info.id));
    }
  });

  it("normalises every form to the height and crown the instancer scales", () => {
    for (const info of ARCHETYPE_CATALOG) {
      const geometry = archetypeGeometry(info.id);
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      let maxY = -Infinity;
      let minY = Infinity;
      let maxR = 0;
      let apex = false;
      let outward = 0;
      let samples = 0;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const radial = Math.hypot(x, z);
        maxY = Math.max(maxY, y);
        minY = Math.min(minY, y);
        maxR = Math.max(maxR, radial);
        if (Math.abs(y - 1) < 1e-3 && radial < 0.02) apex = true;
        if (radial > 0.25) {
          outward += normal.getX(i) * x + normal.getZ(i) * z;
          samples += 1;
        }
      }
      expect(maxY, info.id).toBeCloseTo(1, 3);
      expect(minY, info.id).toBeCloseTo(0, 3);
      expect(maxR, info.id).toBeCloseTo(0.5, 3);
      expect(apex, info.id).toBe(true);
      // Twig normals wrap each branch, so a bare crown averages near zero. A solid crown faces out.
      const mean = outward / samples;
      if (info.id === "leafless") expect(mean, info.id).toBeGreaterThan(-0.08);
      else expect(mean, info.id).toBeGreaterThan(0.02);
    }
  });
});

describe("tree archetype mapping", () => {
  it("only points at forms that exist", () => {
    for (const id of mappedArchetypeIds()) expect(isArchetypeId(id), id).toBe(true);
  });

  it("matches species before genus, then leaf tags, then generic", () => {
    expect(resolveArchetype({ species: "Corymbia maculata" })).toBe("gum-open");
    expect(resolveArchetype({ species: "corymbia_maculata" })).toBe("gum-open");
    expect(resolveArchetype({ species: "  eucalyptus CAESIA " })).toBe("weeping");
    expect(resolveArchetype({ genus: "Eucalyptus" })).toBe("gum-open");
    expect(resolveArchetype({ genus: "Eucalyptus", leafType: "needleleaved" })).toBe("gum-open");
    expect(resolveArchetype({ genus: "Ficus" })).toBe("fig-spreading");
    expect(resolveArchetype({ taxon: "Ficus microcarpa" })).toBe("broadleaf-round");
    expect(resolveArchetype({ species: "Platanus × hispanica" })).toBe("broadleaf-spreading");
    expect(resolveArchetype({ species: "Platanus x acerifolia" })).toBe("broadleaf-spreading");
    expect(resolveArchetype({ genus: "Phoenix", species: "canariensis" })).toBe("palm-date");
    expect(resolveArchetype({ genus: "Ulmus" })).toBe("broadleaf-vase");
    expect(resolveArchetype({ leafType: "needleleaved" })).toBe("conifer-cone");
    expect(resolveArchetype({ leafType: "palm" })).toBe("palm");
    expect(resolveArchetype({ genus: "Pistacia" })).toBe("broadleaf-oval");
    expect(resolveArchetype({ genus: "Stenocarpus" })).toBe("broadleaf-oval");
    expect(resolveArchetype({ leafType: "broad_leaved" })).toBe("broadleaf-round");
    expect(resolveArchetype({ leafCycle: "deciduous" })).toBe("broadleaf-spreading");
    expect(resolveArchetype({ leafType: "leafless", leafCycle: "deciduous" })).toBe("leafless");
    expect(resolveArchetype({ species: "Nope" })).toBe("generic");
    expect(resolveArchetype({})).toBe("generic");
  });

  it("groups instances by archetype and scales each one from height and crown", () => {
    const model: CityModel = {
      placeLabel: "Test",
      center: { lon: 144.979, lat: -37.812 },
      sideM: 200,
      layers: { buildings: false, roads: false, waterGreen: false, trees: true },
      buildings: [],
      roads: [],
      areas: [],
      trees: [
        { id: 1, at: [0, 0], height: 10, crownDiameter: 6, genus: "Ulmus" },
        { id: 2, at: [8, 1], height: 12, crownDiameter: 3, genus: "Ulmus" },
        { id: 3, at: [20, 4], height: 16, crownDiameter: 5, genus: "Phoenix", species: "canariensis" },
      ],
      roadKm: 0,
      buildingCapHit: false,
      sourceNote: "test",
    };
    const group = buildCityGroup(model);
    const meshes: THREE.InstancedMesh[] = [];
    group.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (mesh.isInstancedMesh) meshes.push(mesh);
    });
    expect(meshes).toHaveLength(2);
    expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(3);
    expect(meshes.map((mesh) => mesh.userData.archetype).sort()).toEqual(["broadleaf-vase", "palm-date"]);
    const vase = meshes.find((mesh) => mesh.userData.archetype === "broadleaf-vase");
    expect(vase?.count).toBe(2);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    vase!.getMatrixAt(1, matrix);
    matrix.decompose(position, quaternion, scale);
    expect(scale.y).toBeCloseTo(12);
    expect(scale.x).toBeCloseTo(3);
    expect(position.x).toBeCloseTo(8);
    expect(position.z).toBeCloseTo(-1);
    disposeObject(group);
  });
});
