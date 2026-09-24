import * as THREE from "three";
import rhino3dm from "rhino3dm/rhino3dm.module.js";
import type { RhinoModuleOptions } from "rhino3dm";
import { buildCityGroup, disposeObject } from "./buildCity";
import { CRS_NOTE, mgaCrs, projectLocal, projectLonLat } from "./crs";
import type { CityModel } from "../types";

type Rhino = Awaited<ReturnType<typeof rhino3dm>>;

const LAYER_COLORS: Record<string, { r: number; g: number; b: number }> = {
  Buildings: { r: 246, g: 243, b: 236 },
  Roads: { r: 78, g: 73, b: 67 },
  Rail: { r: 141, g: 98, b: 68 },
  Water: { r: 142, g: 191, b: 200 },
  Green: { r: 127, g: 154, b: 98 },
  Ground: { r: 230, g: 224, b: 212 },
  Trees: { r: 62, g: 138, b: 72 },
};

let rhinoPromise: Promise<Rhino> | null = null;

async function rhinoOptions(): Promise<RhinoModuleOptions> {
  // Vitest runs in Node, where the bundler URL for the wasm file is not a path
  // rhino3dm can read. The browser build drops this branch.
  if (import.meta.env.VITEST) {
    const { readFile } = await import("node:fs/promises");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("rhino3dm/rhino3dm.wasm");
    return { wasmBinary: await readFile(wasmPath) };
  }
  const wasmUrl = (await import("rhino3dm/rhino3dm.wasm?url")).default;
  return { locateFile: () => wasmUrl };
}

export function loadRhino(): Promise<Rhino> {
  if (!rhinoPromise) {
    rhinoPromise = rhinoOptions().then((options) => rhino3dm(options));
  }
  return rhinoPromise;
}

function layerName(mesh: THREE.Mesh): string {
  return mesh.name || mesh.parent?.name || "Mesh";
}

function release(object: object) {
  (object as { delete?: () => void }).delete?.();
}

function addMesh(
  rhino: Rhino,
  doc: InstanceType<Rhino["File3dm"]>,
  layers: Map<string, number>,
  mesh: THREE.Mesh,
  model: CityModel,
  zone: number,
) {
  const position = mesh.geometry.getAttribute("position");
  if (!position || position.count < 3) return;

  const rhinoMesh = new rhino.Mesh();
  const vertices = rhinoMesh.vertices();
  vertices.useDoublePrecisionVertices = true;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    // Three.js is Y-up: x east, y elevation, z = −north.
    const [easting, northing] = projectLocal([vertex.x, -vertex.z], model.center, zone);
    vertices.addPoint3d(easting, northing, vertex.y);
  }

  const faces = rhinoMesh.faces();
  const index = mesh.geometry.getIndex();
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      faces.addTriFace(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i + 2 < position.count; i += 3) {
      faces.addTriFace(i, i + 1, i + 2);
    }
  }
  if (faces.count === 0) {
    release(rhinoMesh);
    return;
  }
  rhinoMesh.normals().computeNormals();

  const name = layerName(mesh);
  let layerIndex = layers.get(name);
  if (layerIndex === undefined) {
    layerIndex = doc.layers().addLayer(name, LAYER_COLORS[name] ?? { r: 180, g: 180, b: 180 });
    layers.set(name, layerIndex);
  }
  const attributes = new rhino.ObjectAttributes();
  attributes.name = name;
  attributes.layerIndex = layerIndex;
  doc.objects().addMesh(rhinoMesh, attributes);
  release(rhinoMesh);
  release(attributes);
}

/** Current city meshes as a Rhino .3dm in MGA metres, Z-up. */
export async function cityModelTo3dm(model: CityModel): Promise<Uint8Array> {
  const rhino = await loadRhino();
  const crs = mgaCrs(model.center.lon);
  const group = buildCityGroup(model);
  const doc = new rhino.File3dm();
  try {
    group.updateMatrixWorld(true);
    doc.applicationName = "CityCut";
    doc.applicationUrl = "https://kchaisor.github.io/citycut-export/";
    doc.applicationDetails = `${model.placeLabel}; ${crs.name}`;
    doc.startSectionComments = `CityCut. ${crs.name}. Metres, Z-up. ${CRS_NOTE}`;
    doc.settings().modelUnitSystem = rhino.UnitSystem.Meters;
    doc.settings().pageUnitSystem = rhino.UnitSystem.Meters;
    doc.strings().set("CRS", crs.name);
    doc.strings().set("CRS note", CRS_NOTE);

    const [easting, northing] = projectLonLat(model.center.lon, model.center.lat, crs.zone);
    const anchor = doc.settings().earthAnchorPoint;
    anchor.earthBasepointLatitude = model.center.lat;
    anchor.earthBasepointLongitude = model.center.lon;
    anchor.earthBasepointElevation = 0;
    anchor.modelBasePoint = [easting, northing, 0];
    anchor.modelEast = [1, 0, 0];
    anchor.modelNorth = [0, 1, 0];
    anchor.name = crs.name;
    anchor.description = CRS_NOTE;
    doc.settings().earthAnchorPoint = anchor;

    const layers = new Map<string, number>();
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      addMesh(rhino, doc, layers, mesh, model, crs.zone);
    });

    return doc.toByteArray();
  } finally {
    doc.destroy();
    disposeObject(group);
  }
}
