import * as THREE from "three";
import { ARCHETYPE_CATALOG, GENERIC_ARCHETYPE, isArchetypeId } from "./treeForms";
import { resolveArchetype } from "./treeMap";
import type { TreeFeat } from "../types";

type GltfAccessor = {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
};

type GltfDocument = {
  buffers: { uri: string }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  accessors: GltfAccessor[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
};

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

const gltfSources = import.meta.glob("../assets/trees/*.gltf", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const geometries = new Map<string, THREE.BufferGeometry>();

function decodeDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  const binary = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function viewBytes(document: GltfDocument, accessor: GltfAccessor, bin: Uint8Array): Uint8Array {
  const bufferView = document.bufferViews[accessor.bufferView];
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const components = COMPONENTS[accessor.type] ?? 1;
  const width = accessor.componentType === 5123 ? 2 : 4;
  return bin.subarray(start, start + accessor.count * components * width);
}

function floats(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.byteLength / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

function ushorts(bytes: Uint8Array): Uint16Array {
  const out = new Uint16Array(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

export function geometryFromGltf(text: string): THREE.BufferGeometry {
  const document = JSON.parse(text) as GltfDocument;
  const bin = decodeDataUri(document.buffers[0].uri);
  const primitive = document.meshes[0].primitives[0];
  const geometry = new THREE.BufferGeometry();
  const position = document.accessors[primitive.attributes.POSITION];
  const normal = document.accessors[primitive.attributes.NORMAL];
  const color = document.accessors[primitive.attributes.COLOR_0];
  geometry.setAttribute("position", new THREE.BufferAttribute(floats(viewBytes(document, position, bin)), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(floats(viewBytes(document, normal, bin)), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(floats(viewBytes(document, color, bin)), 3));
  if (primitive.indices !== undefined) {
    geometry.setIndex(new THREE.BufferAttribute(ushorts(viewBytes(document, document.accessors[primitive.indices], bin)), 1));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function archetypeIdFromPath(path: string): string {
  const file = path.split("/").pop() ?? "";
  return file.replace(/\.gltf$/, "");
}

for (const [path, source] of Object.entries(gltfSources)) {
  geometries.set(archetypeIdFromPath(path), geometryFromGltf(source));
}

for (const info of ARCHETYPE_CATALOG) {
  if (!geometries.has(info.id)) throw new Error(`Missing tree archetype file ${info.id}.gltf.`);
}

export function archetypeForTree(tree: TreeFeat): string {
  if (tree.archetype && isArchetypeId(tree.archetype) && geometries.has(tree.archetype)) return tree.archetype;
  const resolved = resolveArchetype(tree);
  return geometries.has(resolved) ? resolved : GENERIC_ARCHETYPE;
}

export function archetypeGeometry(id: string): THREE.BufferGeometry {
  const geometry = geometries.get(id) ?? geometries.get(GENERIC_ARCHETYPE);
  if (!geometry) throw new Error("Missing generic tree archetype.");
  return geometry;
}

/**
 * One InstancedMesh per archetype. Local forms are 1 m tall with a crown radius
 * of 0.5, so instance scale is (crown diameter, height, crown diameter).
 */
export function buildTreeGroup(trees: TreeFeat[]): THREE.Group | null {
  if (trees.length === 0) return null;
  const buckets = new Map<string, TreeFeat[]>();
  for (const tree of trees) {
    const id = archetypeForTree(tree);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(tree);
    else buckets.set(id, [tree]);
  }

  const group = new THREE.Group();
  group.name = "Trees";
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const [id, bucket] of buckets) {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(archetypeGeometry(id).clone(), material, bucket.length);
    mesh.name = "Trees";
    mesh.userData.archetype = id;
    bucket.forEach((tree, index) => {
      position.set(tree.at[0], 0, -tree.at[1]);
      quaternion.setFromAxisAngle(up, ((tree.id % 12) * Math.PI) / 6);
      scale.set(tree.crownDiameter, tree.height, tree.crownDiameter);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
