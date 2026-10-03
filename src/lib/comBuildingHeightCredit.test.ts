import { describe, expect, it } from "vitest";
import { PDFArray, PDFContentStream, PDFDocument, PDFRawStream, PDFStream, decodePDFRawStream } from "pdf-lib";
import { figureGroundAi8, sitePlanAi8, sitePlanPdf } from "./aiPlan";
import {
  COM_BUILDING_HEIGHTS_CREDIT,
  COM_BUILDING_HEIGHTS_DATASET_URL,
  comBuildingHeightCreditLine,
  showComBuildingHeightFooterCredit,
} from "./comBuildingHeightCredit";
import { cityModelTo3dm, loadRhino } from "./rhinoExport";
import { viewAi } from "./aiView";
import * as THREE from "three";
import { shotFromCamera } from "./cameraShot";
import type { CityModel } from "../types";

const CREDIT_RE = /Building heights: 2023 Building Footprints .*City of Melbourne, CC BY 4\.0/;

const origin = { lon: 144.9631, lat: -37.8136 };

function baseModel(comBuildingHeights: boolean): CityModel {
  return {
    placeLabel: "Test Block",
    center: origin,
    sideM: 200,
    layers: { buildings: true, roads: true, waterGreen: true, trees: false },
    buildings: [{ id: 1, ring: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], holes: [], height: 12, use: "unclassified", source: "none" }],
    roads: [{ id: 2, line: [[-80, 10], [80, 10]], width: 6, kind: "road" }],
    areas: [],
    trees: [],
    roadKm: 0.16,
    buildingCapHit: false,
    sourceNote: "test",
    comBuildingHeights,
  };
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function decodePdfHexText(source: string): string {
  const parts: string[] = [];
  const hex = /<([0-9A-Fa-f]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = hex.exec(source))) {
    const raw = match[1];
    let text = "";
    for (let i = 0; i + 1 < raw.length; i += 2) {
      text += String.fromCharCode(Number.parseInt(raw.slice(i, i + 2), 16));
    }
    if (text.trim()) parts.push(text);
  }
  return parts.join("\n");
}

async function pdfVisibleText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[0];
  const contents = page.node.Contents();
  if (!contents) return "";
  const streamBytes = (value: unknown): Uint8Array => {
    const stream = value instanceof PDFStream ? value : doc.context.lookup(value as PDFRawStream);
    if (!(stream instanceof PDFStream)) return new Uint8Array();
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    if (stream instanceof PDFContentStream) return stream.getUnencodedContents();
    return stream.getContents();
  };
  const parts: Uint8Array[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) parts.push(streamBytes(contents.lookup(i)));
  } else {
    parts.push(streamBytes(contents));
  }
  const joined = new TextDecoder("latin1").decode(
    parts.reduce((acc, part) => {
      const next = new Uint8Array(acc.length + part.length + 1);
      next.set(acc);
      next.set(part, acc.length);
      next[acc.length + part.length] = 10;
      return next;
    }, new Uint8Array()),
  );
  return decodePdfHexText(joined);
}

describe("comBuildingHeightCredit", () => {
  it("returns the credit line only when CoM heights are active", () => {
    expect(comBuildingHeightCreditLine(baseModel(false))).toBeNull();
    expect(comBuildingHeightCreditLine(baseModel(true))).toBe(COM_BUILDING_HEIGHTS_CREDIT);
  });

  it("shows the linked dataset credit in the 3D map footer when CoM heights are active", () => {
    expect(showComBuildingHeightFooterCredit(false)).toBe(false);
    expect(showComBuildingHeightFooterCredit(true)).toBe(true);
    expect(COM_BUILDING_HEIGHTS_DATASET_URL).toMatch(/2023-building-footprints/);
    expect(COM_BUILDING_HEIGHTS_CREDIT).toContain("2023 Building Footprints");
  });

  it("adds the credit to site plan PDF annotation text", async () => {
    const bytes = await sitePlanPdf(baseModel(true), 1000);
    expect(await pdfVisibleText(bytes)).toMatch(CREDIT_RE);
  });

  it("adds the credit to site plan AI8 header metadata via annotation text", () => {
    const bytes = sitePlanAi8(baseModel(true), 1000);
    expect(latin1(bytes)).toMatch(CREDIT_RE);
  });

  it("adds the credit to figure-ground AI8", () => {
    const bytes = figureGroundAi8(baseModel(true), 1000);
    expect(latin1(bytes)).toMatch(CREDIT_RE);
  });

  it("adds the credit to the 3D view PDF annotation", async () => {
    const camera = new THREE.PerspectiveCamera(32, 16 / 10, 0.5, 4000);
    camera.position.set(-90, 80, 110);
    camera.lookAt(0, 6, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const shot = shotFromCamera(camera, 640, 400);
    const bytes = await viewAi(baseModel(true), shot, { uniformBuildings: false, colourBySource: false });
    expect(await pdfVisibleText(bytes)).toMatch(CREDIT_RE);
  });

  it("writes the credit into Rhino start comments and document strings", async () => {
    const bytes = await cityModelTo3dm(baseModel(true));
    const rhino = await loadRhino();
    const doc = rhino.File3dm.fromByteArray(bytes);
    try {
      expect(doc.startSectionComments).toMatch(CREDIT_RE);
      const table = doc.strings();
      let heightsValue: string | null = null;
      for (let i = 0; i < table.count; i++) {
        const entry = table.get(i) as string[];
        if (entry[0] === "Building heights") heightsValue = entry[1];
      }
      expect(heightsValue).toBe(COM_BUILDING_HEIGHTS_CREDIT);
    } finally {
      doc.destroy();
    }
  });
});
