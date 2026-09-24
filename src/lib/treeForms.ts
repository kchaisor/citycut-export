/** Low-poly tree massing forms. Unit height, crown radius 0.5, tip at the origin's top. */

export type ArchetypeInfo = {
  id: string;
  label: string;
  /** What the silhouette stands in for. Massing, not a botanic model. */
  represents: string;
};

export const GENERIC_ARCHETYPE = "generic";

export const ARCHETYPE_CATALOG: readonly ArchetypeInfo[] = [
  { id: "generic", label: "Generic broadleaf", represents: "Unmapped trees. Rounded crown on a clear trunk." },
  { id: "broadleaf-round", label: "Round broadleaf", represents: "Dense globe: brush box, lilly pilly, clipped street figs." },
  { id: "broadleaf-spreading", label: "Spreading broadleaf", represents: "Wide dome: plane, oak, jacaranda, elm-like spread." },
  { id: "broadleaf-vase", label: "Vase broadleaf", represents: "Vase crown: elms and zelkova." },
  { id: "broadleaf-oval", label: "Oval broadleaf", represents: "Upright oval: ash, birch, magnolia, pin oak." },
  { id: "gum-open", label: "Open gum", represents: "Tall trunk and a small high crown: spotted gum and many eucalypts." },
  { id: "gum-broad", label: "Broad gum", represents: "Broader high crown: river red gum, lemon-scented gum, angophora." },
  { id: "columnar", label: "Columnar", represents: "Fastigiate column: Lombardy poplar, hornbeam." },
  { id: "conifer-cone", label: "Cone conifer", represents: "Cone: spruce, fir, young pines." },
  { id: "conifer-column", label: "Column conifer", represents: "Flame column: Italian cypress, Norfolk Island pine." },
  { id: "pine-tiered", label: "Tiered pine", represents: "Stacked whorls: pines, cedar, bunya." },
  { id: "palm", label: "Fan palm", represents: "Slender trunk and a fan crown: Washingtonia, Livistona." },
  { id: "palm-date", label: "Date palm", represents: "Thicker trunk and an arching crown: Canary Island date palm." },
  { id: "weeping", label: "Weeping", represents: "Drooping skirt: willow, peppermint, peppercorn." },
  { id: "small-round", label: "Small round", represents: "Small rounded crown: crepe myrtle, olive, flowering gum, prunus." },
  { id: "shrub", label: "Shrub", represents: "Low mass from the ground: camellia, viburnum, understorey." },
  { id: "open-canopy", label: "Open canopy", represents: "Irregular open crown: acacia, robinia, honey locust, grevillea." },
  { id: "fig-spreading", label: "Spreading fig", represents: "Flat wide crown on a short trunk: Moreton Bay fig." },
  { id: "mallee", label: "Mallee", represents: "Several stems under a low crown." },
  { id: "sheoak", label: "Sheoak", represents: "Fine drooping crown: drooping sheoak and casuarina." },
  { id: "leafless", label: "Leafless", represents: "Bare branch mass for leaf_type=leafless." },
];

const CATALOG_IDS = new Set(ARCHETYPE_CATALOG.map((item) => item.id));

export function isArchetypeId(id: string): boolean {
  return CATALOG_IDS.has(id);
}

type RGB = [number, number, number];

function hex(color: number): RGB {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return [linear(r), linear(g), linear(b)];
}

const TRUNK = hex(0x6b4a30);
const LEAF = hex(0x3e8a48);
const ROUND = hex(0x2f7d45);
const SPREAD = hex(0x3f8f4a);
const VASE = hex(0x4c9150);
const OVAL = hex(0x468a55);
const GUM = hex(0x7d9470);
const GUM_BROAD = hex(0x68865c);
const COLUMN = hex(0x5a8f48);
const CONIFER = hex(0x1e5a38);
const CYPRESS = hex(0x1a4d34);
const PINE = hex(0x2a6240);
const PALM = hex(0x3c8f45);
const DATE = hex(0x2f7a38);
const WEEP = hex(0x4e9a62);
const SMALL = hex(0x5aa15a);
const SHRUB = hex(0x6a9a48);
const OPEN = hex(0x8aaa62);
const FIG = hex(0x2d6b40);
const MALLEE = hex(0x7f9268);
const SHEOAK = hex(0x6d8b62);
const BARE = hex(0x7a6248);

type Ring = { y: number; r: number; c: RGB };

export type ArchetypeMesh = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
};

class Builder {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  v(x: number, y: number, z: number, c: RGB): number {
    const index = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    return index;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  lathe(rings: Ring[], segments = 8) {
    const rows: number[][] = [];
    for (const ring of rings) {
      if (ring.r <= 0.0008) {
        rows.push([this.v(0, ring.y, 0, ring.c)]);
        continue;
      }
      const row: number[] = [];
      for (let s = 0; s < segments; s++) {
        const angle = (s / segments) * Math.PI * 2;
        row.push(this.v(Math.cos(angle) * ring.r, ring.y, Math.sin(angle) * ring.r, ring.c));
      }
      rows.push(row);
    }
    for (let r = 0; r < rows.length - 1; r++) this.join(rows[r], rows[r + 1]);
  }

  /** Thin stem from one point to another, capped at the end. */
  pole(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, radius: number, color: RGB) {
    const segments = 6;
    let dx = x1 - x0;
    let dy = y1 - y0;
    let dz = z1 - z0;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length;
    dy /= length;
    dz /= length;
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(dy) > 0.85) {
      ux = 1;
      uy = 0;
      uz = 0;
    }
    let sx = dy * uz - dz * uy;
    let sy = dz * ux - dx * uz;
    let sz = dx * uy - dy * ux;
    const side = Math.hypot(sx, sy, sz) || 1;
    sx /= side;
    sy /= side;
    sz /= side;
    const bx = dy * sz - dz * sy;
    const by = dz * sx - dx * sz;
    const bz = dx * sy - dy * sx;
    const ring = (x: number, y: number, z: number) => {
      const ids: number[] = [];
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const c = Math.cos(angle) * radius;
        const s = Math.sin(angle) * radius;
        ids.push(this.v(x + sx * c + bx * s, y + sy * c + by * s, z + sz * c + bz * s, color));
      }
      return ids;
    };
    const bottom = ring(x0, y0, z0);
    const top = ring(x1, y1, z1);
    this.join(bottom, top);
    const cap = this.v(x1, y1, z1, color);
    for (let i = 0; i < segments; i++) this.tri(cap, top[(i + 1) % segments], top[i]);
  }

  fronds(count: number, yBase: number, yMid: number, yTip: number, rMid: number, rTip: number, color: RGB) {
    const apex = this.v(0, 1, 0, color);
    const collar: number[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      collar.push(this.v(Math.cos(angle) * 0.07, yBase, Math.sin(angle) * 0.07, color));
    }
    for (let i = 0; i < count; i++) this.tri(apex, collar[i], collar[(i + 1) % count]);
    const spread = Math.PI / count;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const midL = this.v(Math.cos(angle - spread) * rMid, yMid, Math.sin(angle - spread) * rMid, color);
      const midR = this.v(Math.cos(angle + spread) * rMid, yMid, Math.sin(angle + spread) * rMid, color);
      const tip = this.v(Math.cos(angle) * rTip, yTip, Math.sin(angle) * rTip, color);
      this.tri(collar[i], midL, midR);
      this.tri(midL, tip, midR);
    }
  }

  finish(): ArchetypeMesh {
    return finishMesh(this.pos, this.col, this.idx);
  }

  private join(a: number[], b: number[]) {
    if (a.length === 1 && b.length === 1) return;
    if (a.length === 1) {
      for (let s = 0; s < b.length; s++) this.tri(a[0], b[s], b[(s + 1) % b.length]);
      return;
    }
    if (b.length === 1) {
      for (let s = 0; s < a.length; s++) this.tri(b[0], a[(s + 1) % a.length], a[s]);
      return;
    }
    for (let s = 0; s < a.length; s++) {
      const a0 = a[s];
      const a1 = a[(s + 1) % a.length];
      const b0 = b[s];
      const b1 = b[(s + 1) % b.length];
      this.tri(a0, a1, b0);
      this.tri(b1, b0, a1);
    }
  }
}

function finishMesh(rawPos: number[], rawCol: number[], rawIdx: number[]): ArchetypeMesh {
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (let i = 0; i < rawPos.length; i += 3) {
    minY = Math.min(minY, rawPos[i + 1]);
    maxY = Math.max(maxY, rawPos[i + 1]);
    maxR = Math.max(maxR, Math.hypot(rawPos[i], rawPos[i + 2]));
  }
  const height = Math.max(maxY - minY, 1e-6);
  const radius = Math.max(maxR, 1e-6);
  const pos = new Float32Array(rawPos.length);
  for (let i = 0; i < rawPos.length; i += 3) {
    pos[i] = (rawPos[i] / radius) * 0.5;
    pos[i + 1] = (rawPos[i + 1] - minY) / height;
    pos[i + 2] = (rawPos[i + 2] / radius) * 0.5;
  }
  const idx = Uint16Array.from(rawIdx);
  orientOutward(pos, idx);
  const normals = smoothNormals(pos, idx);
  const colors = Float32Array.from(rawCol);
  const mesh = { positions: pos, normals, colors, indices: idx };
  if (!hasApex(mesh.positions)) throw new Error("Tree archetype is missing a tip vertex.");
  return mesh;
}

function hasApex(pos: Float32Array): boolean {
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i + 1] - 1) < 1e-3 && Math.hypot(pos[i], pos[i + 2]) < 0.02) return true;
  }
  return false;
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ia = a * 3;
  const ib = b * 3;
  const ic = c * 3;
  const abx = pos[ib] - pos[ia];
  const aby = pos[ib + 1] - pos[ia + 1];
  const abz = pos[ib + 2] - pos[ia + 2];
  const acx = pos[ic] - pos[ia];
  const acy = pos[ic + 1] - pos[ia + 1];
  const acz = pos[ic + 2] - pos[ia + 2];
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

function orientOutward(pos: Float32Array, idx: Uint16Array) {
  let score = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const normal = faceNormal(pos, idx[i], idx[i + 1], idx[i + 2]);
    const cx = (pos[idx[i] * 3] + pos[idx[i + 1] * 3] + pos[idx[i + 2] * 3]) / 3;
    const cz = (pos[idx[i] * 3 + 2] + pos[idx[i + 1] * 3 + 2] + pos[idx[i + 2] * 3 + 2]) / 3;
    const radial = Math.hypot(cx, cz);
    score += radial < 0.12 ? normal[1] : normal[0] * cx + normal[2] * cz;
  }
  if (score >= 0) return;
  for (let i = 0; i < idx.length; i += 3) {
    const swap = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = swap;
  }
}

function smoothNormals(pos: Float32Array, idx: Uint16Array): Float32Array {
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const normal = faceNormal(pos, idx[i], idx[i + 1], idx[i + 2]);
    for (let k = 0; k < 3; k++) {
      const vertex = idx[i + k] * 3;
      normals[vertex] += normal[0];
      normals[vertex + 1] += normal[1];
      normals[vertex + 2] += normal[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length < 1e-8) {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    } else {
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    }
  }
  return normals;
}

function lathe(rings: Ring[], extra?: (builder: Builder) => void): ArchetypeMesh {
  const builder = new Builder();
  builder.lathe(rings);
  extra?.(builder);
  return builder.finish();
}

function trunk(top: number, radius: number): Ring[] {
  return [
    { y: 0, r: radius * 1.25, c: TRUNK },
    { y: top, r: radius, c: TRUNK },
  ];
}

const FORMS: Record<string, () => ArchetypeMesh> = {
  generic: () =>
    lathe([
      ...trunk(0.4, 0.045),
      { y: 0.38, r: 0.14, c: LEAF },
      { y: 0.55, r: 0.4, c: LEAF },
      { y: 0.74, r: 0.5, c: LEAF },
      { y: 0.9, r: 0.28, c: LEAF },
      { y: 1, r: 0, c: LEAF },
    ]),
  "broadleaf-round": () =>
    lathe([
      ...trunk(0.24, 0.05),
      { y: 0.22, r: 0.16, c: ROUND },
      { y: 0.4, r: 0.42, c: ROUND },
      { y: 0.62, r: 0.5, c: ROUND },
      { y: 0.82, r: 0.36, c: ROUND },
      { y: 1, r: 0, c: ROUND },
    ]),
  "broadleaf-spreading": () =>
    lathe([
      ...trunk(0.32, 0.05),
      { y: 0.3, r: 0.16, c: SPREAD },
      { y: 0.42, r: 0.46, c: SPREAD },
      { y: 0.62, r: 0.5, c: SPREAD },
      { y: 0.82, r: 0.3, c: SPREAD },
      { y: 1, r: 0, c: SPREAD },
    ]),
  "broadleaf-vase": () =>
    lathe([
      ...trunk(0.34, 0.045),
      { y: 0.36, r: 0.1, c: VASE },
      { y: 0.55, r: 0.28, c: VASE },
      { y: 0.78, r: 0.5, c: VASE },
      { y: 0.92, r: 0.26, c: VASE },
      { y: 1, r: 0, c: VASE },
    ]),
  "broadleaf-oval": () =>
    lathe([
      ...trunk(0.28, 0.045),
      { y: 0.3, r: 0.16, c: OVAL },
      { y: 0.5, r: 0.38, c: OVAL },
      { y: 0.72, r: 0.5, c: OVAL },
      { y: 0.88, r: 0.24, c: OVAL },
      { y: 1, r: 0, c: OVAL },
    ]),
  "gum-open": () =>
    lathe([
      ...trunk(0.72, 0.035),
      { y: 0.68, r: 0.08, c: GUM },
      { y: 0.8, r: 0.5, c: GUM },
      { y: 0.92, r: 0.24, c: GUM },
      { y: 1, r: 0, c: GUM },
    ]),
  "gum-broad": () =>
    lathe([
      ...trunk(0.5, 0.04),
      { y: 0.46, r: 0.14, c: GUM_BROAD },
      { y: 0.62, r: 0.5, c: GUM_BROAD },
      { y: 0.82, r: 0.32, c: GUM_BROAD },
      { y: 1, r: 0, c: GUM_BROAD },
    ]),
  columnar: () =>
    lathe([
      { y: 0, r: 0.08, c: TRUNK },
      { y: 0.08, r: 0.42, c: COLUMN },
      { y: 0.55, r: 0.5, c: COLUMN },
      { y: 0.84, r: 0.32, c: COLUMN },
      { y: 1, r: 0, c: COLUMN },
    ]),
  "conifer-cone": () =>
    lathe([
      ...trunk(0.14, 0.05),
      { y: 0.1, r: 0.5, c: CONIFER },
      { y: 0.42, r: 0.32, c: CONIFER },
      { y: 0.72, r: 0.14, c: CONIFER },
      { y: 1, r: 0, c: CONIFER },
    ]),
  "conifer-column": () =>
    lathe([
      { y: 0, r: 0.1, c: TRUNK },
      { y: 0.1, r: 0.5, c: CYPRESS },
      { y: 0.42, r: 0.3, c: CYPRESS },
      { y: 0.72, r: 0.16, c: CYPRESS },
      { y: 1, r: 0, c: CYPRESS },
    ]),
  "pine-tiered": () => {
    const builder = new Builder();
    builder.lathe(trunk(0.28, 0.05));
    const tiers: [number, number, number][] = [
      [0.22, 0.5, 0.48],
      [0.42, 0.36, 0.66],
      [0.6, 0.24, 0.82],
      [0.76, 0.14, 1],
    ];
    for (const [y0, radius, y1] of tiers) {
      builder.lathe([
        { y: y0, r: radius, c: PINE },
        { y: y1, r: 0, c: PINE },
      ]);
    }
    return builder.finish();
  },
  palm: () => {
    const builder = new Builder();
    builder.lathe([
      { y: 0, r: 0.055, c: TRUNK },
      { y: 0.78, r: 0.032, c: TRUNK },
      { y: 0.86, r: 0.05, c: TRUNK },
    ]);
    builder.fronds(8, 0.84, 0.9, 0.66, 0.26, 0.5, PALM);
    return builder.finish();
  },
  "palm-date": () => {
    const builder = new Builder();
    builder.lathe([
      { y: 0, r: 0.09, c: TRUNK },
      { y: 0.7, r: 0.07, c: TRUNK },
      { y: 0.8, r: 0.09, c: TRUNK },
    ]);
    builder.fronds(10, 0.78, 0.84, 0.42, 0.28, 0.5, DATE);
    return builder.finish();
  },
  weeping: () => {
    const builder = new Builder();
    builder.lathe(trunk(0.5, 0.045));
    builder.lathe([
      { y: 1, r: 0, c: WEEP },
      { y: 0.86, r: 0.2, c: WEEP },
      { y: 0.64, r: 0.38, c: WEEP },
      { y: 0.4, r: 0.5, c: WEEP },
      { y: 0.48, r: 0.1, c: WEEP },
    ]);
    return builder.finish();
  },
  "small-round": () =>
    lathe([
      ...trunk(0.36, 0.04),
      { y: 0.32, r: 0.12, c: SMALL },
      { y: 0.5, r: 0.4, c: SMALL },
      { y: 0.7, r: 0.5, c: SMALL },
      { y: 0.88, r: 0.26, c: SMALL },
      { y: 1, r: 0, c: SMALL },
    ]),
  shrub: () =>
    lathe([
      { y: 0, r: 0.16, c: SHRUB },
      { y: 0.2, r: 0.5, c: SHRUB },
      { y: 0.55, r: 0.44, c: SHRUB },
      { y: 0.82, r: 0.2, c: SHRUB },
      { y: 1, r: 0, c: SHRUB },
    ]),
  "open-canopy": () =>
    lathe([
      ...trunk(0.46, 0.04),
      { y: 0.44, r: 0.1, c: OPEN },
      { y: 0.56, r: 0.48, c: OPEN },
      { y: 0.66, r: 0.16, c: OPEN },
      { y: 0.8, r: 0.5, c: OPEN },
      { y: 0.9, r: 0.18, c: OPEN },
      { y: 1, r: 0, c: OPEN },
    ]),
  "fig-spreading": () =>
    lathe([
      ...trunk(0.58, 0.07),
      { y: 0.54, r: 0.12, c: FIG },
      { y: 0.64, r: 0.5, c: FIG },
      { y: 0.8, r: 0.4, c: FIG },
      { y: 0.92, r: 0.16, c: FIG },
      { y: 1, r: 0, c: FIG },
    ]),
  mallee: () => {
    const builder = new Builder();
    const stems: [number, number][] = [
      [0.12, 0.02],
      [-0.08, 0.1],
      [-0.02, -0.11],
    ];
    for (const [x, z] of stems) builder.pole(x * 0.2, 0, z * 0.2, x, 0.5, z, 0.035, TRUNK);
    builder.lathe([
      { y: 0.42, r: 0.1, c: MALLEE },
      { y: 0.56, r: 0.4, c: MALLEE },
      { y: 0.74, r: 0.5, c: MALLEE },
      { y: 0.9, r: 0.24, c: MALLEE },
      { y: 1, r: 0, c: MALLEE },
    ]);
    return builder.finish();
  },
  sheoak: () => {
    const builder = new Builder();
    builder.lathe([
      ...trunk(0.48, 0.03),
      { y: 0.55, r: 0.12, c: SHEOAK },
      { y: 0.78, r: 0.22, c: SHEOAK },
      { y: 1, r: 0, c: SHEOAK },
    ]);
    builder.lathe([
      { y: 0.92, r: 0.12, c: SHEOAK },
      { y: 0.7, r: 0.32, c: SHEOAK },
      { y: 0.46, r: 0.5, c: SHEOAK },
      { y: 0.52, r: 0.08, c: SHEOAK },
    ]);
    return builder.finish();
  },
  leafless: () => {
    const builder = new Builder();
    builder.lathe(trunk(0.62, 0.04));
    const tips: [number, number, number][] = [
      [0, 1, 0],
      [0.46, 0.74, 0.12],
      [-0.34, 0.82, 0.22],
      [0.16, 0.6, -0.48],
      [-0.22, 0.9, -0.28],
      [0.3, 0.52, 0.26],
    ];
    for (const [x, y, z] of tips) builder.pole(0, 0.45, 0, x, y, z, 0.02, BARE);
    return builder.finish();
  },
};

export function buildArchetypeMesh(id: string): ArchetypeMesh {
  const form = FORMS[id];
  if (!form) throw new Error(`Unknown tree archetype ${id}.`);
  return form();
}

function accessorMinMax(values: Float32Array, stride: number): { min: number[]; max: number[] } {
  const min = Array(stride).fill(Infinity);
  const max = Array(stride).fill(-Infinity);
  for (let i = 0; i < values.length; i++) {
    const channel = i % stride;
    min[channel] = Math.min(min[channel], values[i]);
    max[channel] = Math.max(max[channel], values[i]);
  }
  return { min, max };
}

function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** glTF 2.0 JSON with an embedded buffer. Same bytes as a GLB bin chunk. */
export function archetypeGltf(id: string): string {
  const mesh = buildArchetypeMesh(id);
  const parts = [bytesOf(mesh.positions), bytesOf(mesh.normals), bytesOf(mesh.colors), bytesOf(mesh.indices)];
  const offsets: number[] = [];
  let cursor = 0;
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const aligned = (cursor + 3) & ~3;
    if (aligned > cursor) chunks.push(new Uint8Array(aligned - cursor));
    cursor = aligned;
    offsets.push(cursor);
    chunks.push(part);
    cursor += part.byteLength;
  }
  const padded = (cursor + 3) & ~3;
  if (padded > cursor) chunks.push(new Uint8Array(padded - cursor));
  const bin = new Uint8Array(padded);
  let write = 0;
  for (const chunk of chunks) {
    bin.set(chunk, write);
    write += chunk.byteLength;
  }
  const position = accessorMinMax(mesh.positions, 3);
  const normal = accessorMinMax(mesh.normals, 3);
  const color = accessorMinMax(mesh.colors, 3);
  const views = parts.map((part, index) => ({
    buffer: 0,
    byteOffset: offsets[index],
    byteLength: part.byteLength,
    target: index === 3 ? 34963 : 34962,
  }));
  const document = {
    asset: { version: "2.0", generator: "CityCut" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: id, mesh: 0 }],
    meshes: [
      {
        name: id,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
            indices: 3,
            mode: 4,
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: mesh.positions.length / 3,
        type: "VEC3",
        min: position.min,
        max: position.max,
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: mesh.normals.length / 3,
        type: "VEC3",
        min: normal.min,
        max: normal.max,
      },
      {
        bufferView: 2,
        componentType: 5126,
        count: mesh.colors.length / 3,
        type: "VEC3",
        min: color.min,
        max: color.max,
      },
      {
        bufferView: 3,
        componentType: 5123,
        count: mesh.indices.length,
        type: "SCALAR",
      },
    ],
    bufferViews: views,
    buffers: [
      {
        byteLength: bin.byteLength,
        uri: `data:application/octet-stream;base64,${encodeBase64(bin)}`,
      },
    ],
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
