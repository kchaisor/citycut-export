import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildTreeGroup } from "./treeArchetypes";
import { openRing, signedArea } from "./geo";
import type { CityModel, Pt, Ring } from "../types";

function orient(ring: Ring, ccw: boolean): Pt[] {
  const points = openRing(ring);
  if (points.length < 3) return points;
  const positive = signedArea(points) > 0;
  if (positive !== ccw) points.reverse();
  return points;
}

function shapeFromRing(outer: Ring, holes: Ring[]): THREE.Shape | null {
  const contour = orient(outer, true);
  if (contour.length < 3) return null;
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
  return shape;
}

function layFlat(geometry: THREE.BufferGeometry, y: number): THREE.BufferGeometry {
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  geometry.clearGroups();
  geometry.computeVertexNormals();
  return geometry;
}

function mergeMeshes(
  geometries: THREE.BufferGeometry[],
  material: THREE.Material,
  name: string,
): THREE.Object3D | null {
  const usable = geometries.filter((geometry) => geometry.getAttribute("position"));
  if (usable.length === 0) return null;
  try {
    const merged = mergeGeometries(usable, false);
    if (!merged) throw new Error("empty merge");
    usable.forEach((geometry) => geometry.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    return mesh;
  } catch {
    const group = new THREE.Group();
    group.name = name;
    for (const geometry of usable) group.add(new THREE.Mesh(geometry, material));
    return group;
  }
}

function ribbonPositions(line: Pt[], width: number, y: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 0.2) continue;
    const px = (-dy / length) * (width / 2);
    const py = (dx / length) * (width / 2);
    const toWorld = (east: number, north: number): [number, number, number] => [east, y, -north];
    const aL = toWorld(a[0] + px, a[1] + py);
    const aR = toWorld(a[0] - px, a[1] - py);
    const bL = toWorld(b[0] + px, b[1] + py);
    const bR = toWorld(b[0] - px, b[1] - py);
    positions.push(...aL, ...bL, ...bR, ...aL, ...bR, ...aR);
  }
  return positions;
}

function ribbonGeometry(lines: { line: Pt[]; width: number }[], y: number): THREE.BufferGeometry | null {
  const positions: number[] = [];
  for (const item of lines) positions.push(...ribbonPositions(item.line, item.width, y));
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildCityGroup(model: CityModel): THREE.Group {
  const group = new THREE.Group();
  group.name = "CityCut";
  group.userData = {
    generator: "CityCut",
    center: model.center,
    sideM: model.sideM,
  };

  const slabGeo = new THREE.BoxGeometry(model.sideM, 8, model.sideM);
  const sideMat = new THREE.MeshStandardMaterial({ color: "#c9c0b0", roughness: 0.92 });
  const topMat = new THREE.MeshStandardMaterial({ color: "#e6e0d4", roughness: 0.95 });
  const bottomMat = new THREE.MeshStandardMaterial({ color: "#b7ad9e", roughness: 1 });
  const slab = new THREE.Mesh(slabGeo, [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]);
  slab.position.y = -4;
  slab.name = "Ground";
  group.add(slab);

  const greenMat = new THREE.MeshStandardMaterial({ color: "#7f9a62", roughness: 1 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: "#8ebfc8",
    roughness: 0.35,
    metalness: 0.04,
  });
  const greenGeos: THREE.BufferGeometry[] = [];
  const waterGeos: THREE.BufferGeometry[] = [];
  for (const area of model.areas) {
    const shape = shapeFromRing(area.ring, area.holes);
    if (!shape) continue;
    try {
      const geometry = layFlat(new THREE.ShapeGeometry(shape), area.kind === "water" ? 0.08 : 0.04);
      if (area.kind === "water") waterGeos.push(geometry);
      else greenGeos.push(geometry);
    } catch {
      /* Skip a broken polygon rather than failing the whole block. */
    }
  }
  const green = mergeMeshes(greenGeos, greenMat, "Green");
  const water = mergeMeshes(waterGeos, waterMat, "Water");
  if (green) group.add(green);
  if (water) group.add(water);

  const roadMat = new THREE.MeshStandardMaterial({ color: "#4e4943", roughness: 0.95 });
  const railMat = new THREE.MeshStandardMaterial({ color: "#8d6244", roughness: 0.8 });
  const roadGeo = ribbonGeometry(
    model.roads.filter((road) => road.kind === "road"),
    0.12,
  );
  const railGeo = ribbonGeometry(
    model.roads.filter((road) => road.kind === "rail"),
    0.18,
  );
  if (roadGeo) {
    const mesh = new THREE.Mesh(roadGeo, roadMat);
    mesh.name = "Roads";
    group.add(mesh);
  }
  if (railGeo) {
    const mesh = new THREE.Mesh(railGeo, railMat);
    mesh.name = "Rail";
    group.add(mesh);
  }

  const buildingMat = new THREE.MeshStandardMaterial({ color: "#f6f3ec", roughness: 0.78 });
  const buildingGeos: THREE.BufferGeometry[] = [];
  for (const building of model.buildings) {
    const shape = shapeFromRing(building.ring, building.holes);
    if (!shape) continue;
    try {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: building.height,
        bevelEnabled: false,
      });
      layFlat(geometry, 0);
      buildingGeos.push(geometry);
    } catch {
      try {
        const fallback = shapeFromRing(building.ring, []);
        if (!fallback) continue;
        const geometry = new THREE.ExtrudeGeometry(fallback, {
          depth: building.height,
          bevelEnabled: false,
        });
        layFlat(geometry, 0);
        buildingGeos.push(geometry);
      } catch {
        /* Ignore footprints Three.js cannot extrude. */
      }
    }
  }
  const buildings = mergeMeshes(buildingGeos, buildingMat, "Buildings");
  if (buildings) group.add(buildings);

  const trees = buildTreeGroup(model.trees);
  if (trees) group.add(trees);

  return group;
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}
