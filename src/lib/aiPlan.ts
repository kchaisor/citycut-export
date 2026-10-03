import type { PdfChunk, PdfPath, Rgb } from "./aiDocument";
import { useNativeAi8Export } from "./aiExportFormat";
import { buildLayeredNativeAi } from "./aiNative";
import { buildLayeredNativeAiPdfOps } from "./aiNativePdfFallback";
import { buildLayeredPdf } from "./aiDocument";
import { getColour, type ColourKey } from "./colours";
import {
  dashIsDotted,
  dashPair,
  haloMm,
  readDrawingStyle,
  type LineStyles,
  type StrokeStyle,
} from "./drawingStyle";
import {
  figureGround,
  layoutSheet,
  paperMillimetres,
  type SheetLayout,
} from "./figureGround";
import { formatCoord, openRing } from "./geo";
import { LINE_MM, hexRgb } from "./lineweights";
import { footpathLines, unionFootpaths } from "./roadFill";
import { heliodonPlanPdfChunk } from "./heliodonPlanExport";
import type { HeliodonDiagramExportOptions } from "./heliodonDiagram";
import { planShadowRings, type PlanShadowInput } from "./buildingShadows";
import { planPaths } from "./svgPlan";
import { comBuildingHeightCreditLine } from "./comBuildingHeightCredit";
import { VICMAP_CONTOUR_ATTRIBUTION } from "./vicmapContours";
import type { CityModel, Pt } from "../types";

export const SITE_LAYER_ORDER = [
  "Frame",
  "Green",
  "Water",
  "Roads",
  "Paths",
  "Rail",
  "Buildings",
  "Trees",
  "Contours",
  "Contour labels",
  "Shadows",
  "Sun path",
  "Annotation",
] as const;

export const FIGURE_LAYER_ORDER = ["Frame", "Buildings", "Paths", "Sun path", "Annotation"] as const;

/** Sheet colour. A path or rail casing uses this so it vanishes on the page and reads on the road fill. */
function fillOf(name: ColourKey): Rgb {
  return hexRgb(getColour(name));
}

function pen(style: StrokeStyle, join: "miter" | "round" = "round"): Partial<PdfPath> | null {
  if (!(style.mm > 0)) return null;
  const dash = dashPair(style.dash);
  const dotted = dashIsDotted(style.dash);
  return {
    stroke: hexRgb(style.color),
    strokeMm: style.mm,
    ...(dash ? { dashMm: dash } : {}),
    cap: dotted ? "round" : "butt",
    join,
  };
}

function sheetPoint(east: number, north: number, sideM: number, layout: SheetLayout): [number, number] {
  const half = sideM / 2;
  const x = layout.frameX + ((east + half) / sideM) * layout.frameMm;
  const yDown = layout.frameY + ((half - north) / sideM) * layout.frameMm;
  return [x, layout.pageHeightMm - yDown];
}

function mapRing(ring: Pt[], sideM: number, layout: SheetLayout): number[][] {
  return openRing(ring).map((point) => sheetPoint(point[0], point[1], sideM, layout));
}

function yUp(yDown: number, pageHeightMm: number): number {
  return pageHeightMm - yDown;
}

function titleLine(model: CityModel, layout: SheetLayout): string {
  return `${model.placeLabel} · 1:${layout.scale} · ${formatCoord(model.center.lat)}, ${formatCoord(model.center.lon)}`;
}

function creditLine(
  model: CityModel,
  layout: SheetLayout,
  interval: number | null,
  source: "vicmap-metro" | "vicmap-state" | "dem" | null,
): string {
  const parts = ["© OpenStreetMap contributors. CityCut."];
  const comCredit = comBuildingHeightCreditLine(model);
  if (comCredit) parts.push(comCredit);
  if (interval && (source === "vicmap-metro" || source === "vicmap-state")) {
    parts.push(`Contours every ${interval} m. ${VICMAP_CONTOUR_ATTRIBUTION}`);
  } else if (interval) {
    parts.push(`Contours every ${interval} m. Terrain © Mapterhorn.`);
  }
  if (layout.note) parts.push(layout.note);
  return parts.join(" ");
}

function annotation(
  model: CityModel,
  layout: SheetLayout,
  interval: number | null,
  style: StrokeStyle,
  source: "vicmap-metro" | "vicmap-state" | "dem" | null = null,
): PdfChunk {
  const ink = hexRgb(style.color);
  const page = layout.pageHeightMm;
  const tip: [number, number] = [layout.northX, yUp(layout.northTipY, page)];
  const base: [number, number] = [layout.northX, yUp(layout.northBaseY, page)];
  const shaft: [number, number] = [layout.northX, yUp(layout.northTipY + 1.7, page)];
  const headL: [number, number] = [layout.northX - 0.9, yUp(layout.northTipY + 1.8, page)];
  const headR: [number, number] = [layout.northX + 0.9, yUp(layout.northTipY + 1.8, page)];
  const barBottom = yUp(layout.barY + layout.barHeightMm, page);
  const label = titleLine(model, layout);
  const credit = creditLine(model, layout, interval, source);
  return {
    name: "Annotation",
    paths: [
      {
        rings: [[[layout.barX, barBottom], [layout.barX + layout.barMm / 2, barBottom], [layout.barX + layout.barMm / 2, barBottom + layout.barHeightMm], [layout.barX, barBottom + layout.barHeightMm]]],
        fill: ink,
        close: true,
        evenOdd: false,
      },
      {
        rings: [[[layout.barX, barBottom], [layout.barX + layout.barMm, barBottom], [layout.barX + layout.barMm, barBottom + layout.barHeightMm], [layout.barX, barBottom + layout.barHeightMm]]],
        stroke: ink,
        strokeMm: style.mm,
        ...(dashPair(style.dash) ? { dashMm: dashPair(style.dash)! } : {}),
        cap: dashIsDotted(style.dash) ? "round" : "butt",
        close: true,
      },
      {
        rings: [[base, shaft]],
        close: false,
        stroke: ink,
        strokeMm: style.mm,
        ...(dashPair(style.dash) ? { dashMm: dashPair(style.dash)! } : {}),
        cap: dashIsDotted(style.dash) ? "round" : "butt",
      },
      {
        rings: [[tip, headL, headR]],
        fill: ink,
        close: true,
        evenOdd: false,
      },
    ],
    texts: [
      {
        x: layout.barX + layout.barMm + 1.8,
        y: yUp(layout.barY + layout.barHeightMm * 0.82, page),
        sizeMm: 2.3,
        text: `${layout.barMetres} m`,
        color: ink,
      },
      {
        x: layout.northX + 1.8,
        y: yUp(layout.northTipY + 3.2, page),
        sizeMm: 2.6,
        text: "N",
        color: ink,
      },
      {
        x: layout.edgeMm,
        y: yUp(layout.titleY, page),
        sizeMm: 2.6,
        text: label,
        color: ink,
      },
      {
        x: layout.edgeMm,
        y: yUp(layout.creditY, page),
        sizeMm: 2.2,
        text: credit,
        color: ink,
      },
    ],
  };
}

function frameStroke(layout: SheetLayout, style: StrokeStyle): PdfChunk {
  const page = layout.pageHeightMm;
  const bottom = yUp(layout.frameY + layout.frameMm, page);
  const x = layout.frameX;
  const top = bottom + layout.frameMm;
  const drawn = pen(style, "miter");
  return {
    name: "Frame",
    paths: [
      {
        rings: [[[x, bottom], [x + layout.frameMm, bottom], [x + layout.frameMm, top], [x, top]]],
        ...(drawn ?? { stroke: hexRgb(style.color), strokeMm: style.mm }),
        close: true,
      },
    ],
  };
}

/**
 * Site-plan layers. Colours, weights, and dashes come from `style`, which
 * `readDrawingStyle` fills from `getComputedStyle(document.documentElement)`
 * at export time. That computed style is the drawing-style.css cascade, plus
 * any inline variables the Line styles editor has set.
 */
function pathStrip(polygons: Pt[][][], model: CityModel, layout: SheetLayout, style: LineStyles): PdfChunk | null {
  const rings = polygons.flatMap((polygon) => mapRings(polygon, model.sideM, layout));
  if (rings.length === 0) return null;
  const edge = style.pathEdgeOn ? pen(style.path) : null;
  return {
    name: "Paths",
    paths: [
      {
        rings,
        fill: hexRgb(style.pathFill),
        evenOdd: true,
        close: true,
        join: "round",
        ...(edge ?? {}),
      },
    ],
  };
}

export type SitePlanExportOptions = {
  heliodon?: HeliodonDiagramExportOptions | null;
  shadows?: PlanShadowInput | null;
  castShadows?: boolean;
};

function resolveSitePlanExport(
  exportOptions?: SitePlanExportOptions | HeliodonDiagramExportOptions | null,
): SitePlanExportOptions {
  if (!exportOptions) return {};
  if ("shadows" in exportOptions || "castShadows" in exportOptions || "heliodon" in exportOptions) {
    return exportOptions as SitePlanExportOptions;
  }
  return { heliodon: exportOptions as HeliodonDiagramExportOptions };
}

export function sitePlanChunks(
  model: CityModel,
  scale: number,
  style: LineStyles = readDrawingStyle(),
  exportOptions?: SitePlanExportOptions | HeliodonDiagramExportOptions | null,
): PdfChunk[] {
  const resolved = resolveSitePlanExport(exportOptions);
  const heliodon = resolved.heliodon ?? null;
  const shadowInput = resolved.shadows ?? null;
  const castShadows = Boolean(resolved.castShadows);
  const layout = layoutSheet(model.sideM, scale);
  const plan = planPaths(
    model,
    style.pathWidthM,
    style.contourIndexEvery,
    scale,
    style.contourCoarseIntervalM,
    style.contourCoarseFromScale,
  );
  const page = layout.pageHeightMm;
  const bottom = yUp(layout.frameY + layout.frameMm, page);
  const chunks: PdfChunk[] = [
    {
      name: "Frame",
      paths: [
        {
          rings: [[
            [layout.frameX, bottom],
            [layout.frameX + layout.frameMm, bottom],
            [layout.frameX + layout.frameMm, bottom + layout.frameMm],
            [layout.frameX, bottom + layout.frameMm],
          ]],
          fill: fillOf("--sheet-fill"),
          close: true,
          evenOdd: false,
        },
      ],
    },
  ];

  const greenPen = pen(style.green);
  const green = plan.green.map((rings) => mapRings(rings, model.sideM, layout)).filter((rings) => rings.length > 0);
  if (green.length > 0) {
    chunks.push({
      name: "Green",
      paths: green.map((rings) => ({
        rings,
        fill: fillOf("--green-fill"),
        evenOdd: true,
        close: true,
        ...(greenPen ?? {}),
      })),
    });
  }
  const waterPen = pen(style.water);
  const water = plan.water.map((rings) => mapRings(rings, model.sideM, layout)).filter((rings) => rings.length > 0);
  if (water.length > 0) {
    chunks.push({
      name: "Water",
      paths: water.map((rings) => ({
        rings,
        fill: fillOf("--water-fill"),
        evenOdd: true,
        close: true,
        ...(waterPen ?? {}),
      })),
    });
  }
  const footpaths = pathStrip(plan.pathFill, model, layout, style);
  if (footpaths) chunks.push(footpaths);
  const roadRings = plan.roadFill.flatMap((polygon) => mapRings(polygon, model.sideM, layout));
  if (roadRings.length > 0) {
    const kerb = style.kerbOn ? pen(style.kerb) : null;
    chunks.push({
      name: "Roads",
      paths: [
        {
          rings: roadRings,
          fill: hexRgb(style.roadFill),
          evenOdd: true,
          close: true,
          join: "round",
          ...(kerb ?? {}),
        },
      ],
    });
  }
  const contourPen = pen(style.contour);
  const indexPen = pen({ ...style.contour, mm: style.contourIndexMm });
  if (plan.contours.length > 0 && contourPen) {
    chunks.push({
      name: "Contours",
      paths: plan.contours.map((line, index) => ({
        rings: [mapRing(line, model.sideM, layout)],
        close: false,
        ...(plan.contourIndex[index] && indexPen ? indexPen : contourPen),
      })),
    });
  }
  if (plan.contourLabels.length > 0) {
    chunks.push({
      name: "Contour labels",
      texts: plan.contourLabels.map((label) => {
        const [x, y] = sheetPoint(label.east, label.north, model.sideM, layout);
        return { x, y, sizeMm: 1.6, text: label.text, color: fillOf("--contour-label") };
      }),
    });
  }
  const railPen = pen(style.rail);
  if (plan.rails.length > 0 && railPen) {
    chunks.push({
      name: "Rail",
      paths: plan.rails.flatMap((line) => casedLine(mapRing(line, model.sideM, layout), style.rail, railPen)),
    });
  }
  const treePen = pen(style.tree);
  if (plan.trees.length > 0) {
    chunks.push({
      name: "Trees",
      ellipses: plan.trees.map((tree) => {
        const [cx, cy] = sheetPoint(tree.east, tree.north, model.sideM, layout);
        const radius = paperMillimetres(tree.r, scale);
        return {
          kind: "ellipse" as const,
          cx,
          cy,
          rx: radius,
          ry: radius,
          fill: fillOf("--tree-fill"),
          ...(treePen ?? {}),
        };
      }),
    });
  }
  const shadowRings = shadowInput ? planShadowRings(model, shadowInput, castShadows) : [];
  if (shadowRings.length > 0) {
    chunks.push({
      name: "Shadows",
      paths: shadowRings.map((rings) => ({
        rings: mapRings(rings, model.sideM, layout),
        fill: fillOf("--shadow-fill"),
        evenOdd: true,
        close: true,
      })),
    });
  }
  const buildingPen = pen(style.building, "miter");
  if (plan.buildings.length > 0) {
    chunks.push({
      name: "Buildings",
      paths: plan.buildings.map((building) => ({
        rings: mapRings(building.rings, model.sideM, layout),
        fill: hexRgb(building.fill),
        evenOdd: true,
        close: true,
        ...(buildingPen ?? {}),
      })),
    });
  }
  chunks.push(frameStroke(layout, style.frame));
  if (heliodon) chunks.push(heliodonPlanPdfChunk(model.sideM, layout, heliodon, scale));
  chunks.push(annotation(model, layout, plan.contourInterval, style.annotation, plan.contourSource));
  return chunks;
}

/** A paper casing under the stroke, so the line still shows on the dark road fill. */
function casedLine(ring: number[][], style: StrokeStyle, drawn: Partial<PdfPath>): PdfPath[] {
  const casing = haloMm(style.mm);
  const line: PdfPath = { rings: [ring], close: false, ...drawn, cap: "round", join: "round" };
  if (!(casing > style.mm)) return [line];
  return [
    { rings: [ring], close: false, stroke: fillOf("--sheet-fill"), strokeMm: casing, cap: "round", join: "round" },
    line,
  ];
}

function mapRings(rings: Pt[][], sideM: number, layout: SheetLayout): number[][][] {
  return rings.map((ring) => mapRing(ring, sideM, layout)).filter((ring) => ring.length >= 3);
}

export function figureGroundChunks(
  model: CityModel,
  scale: number,
  style: LineStyles = readDrawingStyle(),
  heliodon?: HeliodonDiagramExportOptions | null,
): PdfChunk[] {
  const layout = layoutSheet(model.sideM, scale);
  const ground = figureGround(model.buildings, model.sideM);
  const chunks: PdfChunk[] = [];
  const foot = unionFootpaths(footpathLines(model.roads), style.pathWidthM, model.sideM);
  const strip = pathStrip(foot.polygons, model, layout, style);
  if (strip) chunks.push(strip);
  const paths = ground.polygons
    .map((polygon) => mapRings(polygon, model.sideM, layout))
    .filter((rings) => rings.length > 0)
    .map((rings) => ({
      rings,
      fill: fillOf("--figure-fill"),
      evenOdd: true,
      close: true,
    }));
  if (paths.length > 0) chunks.push({ name: "Buildings", paths });
  chunks.push(frameStroke(layout, { mm: LINE_MM.frame, color: getColour("--figure-fill"), dash: "none" }));
  if (heliodon) chunks.push(heliodonPlanPdfChunk(model.sideM, layout, heliodon, scale));
  chunks.push(annotation(model, layout, null, { mm: LINE_MM.annotation, color: style.annotation.color, dash: "none" }));
  return chunks;
}

function sitePlanLayerOrder(chunks: PdfChunk[]): string[] {
  const order: string[] = [...SITE_LAYER_ORDER];
  if (!order.includes("Contour labels") && chunks.some((chunk) => chunk.name === "Contour labels")) {
    const at = order.indexOf("Contours");
    order.splice(at + 1, 0, "Contour labels");
  }
  return order;
}

/** PDF/OCG site plan, the default .ai export. */
export async function sitePlanPdf(
  model: CityModel,
  scale: number,
  style?: LineStyles,
  exportOptions?: SitePlanExportOptions | HeliodonDiagramExportOptions | null,
): Promise<Uint8Array> {
  const layout = layoutSheet(model.sideM, scale);
  const chunks = sitePlanChunks(model, scale, style ?? readDrawingStyle(), exportOptions);
  return buildLayeredPdf(layout.pageWidthMm, layout.pageHeightMm, chunks, sitePlanLayerOrder(chunks));
}

export async function figureGroundPdf(
  model: CityModel,
  scale: number,
  style?: LineStyles,
  heliodon?: HeliodonDiagramExportOptions | null,
): Promise<Uint8Array> {
  const layout = layoutSheet(model.sideM, scale);
  return buildLayeredPdf(
    layout.pageWidthMm,
    layout.pageHeightMm,
    figureGroundChunks(model, scale, style ?? readDrawingStyle(), heliodon),
    FIGURE_LAYER_ORDER,
  );
}

/** Illustrator 8 EPS site plan. Opt-in with VITE_CITYCUT_AI_NATIVE=true. */
export function sitePlanAi8(
  model: CityModel,
  scale: number,
  style?: LineStyles,
  exportOptions?: SitePlanExportOptions | HeliodonDiagramExportOptions | null,
): Uint8Array {
  const layout = layoutSheet(model.sideM, scale);
  const chunks = sitePlanChunks(model, scale, style ?? readDrawingStyle(), exportOptions);
  return buildLayeredNativeAi(
    layout.pageWidthMm,
    layout.pageHeightMm,
    chunks,
    sitePlanLayerOrder(chunks),
    titleLine(model, layout),
  );
}

export function figureGroundAi8(
  model: CityModel,
  scale: number,
  style?: LineStyles,
  heliodon?: HeliodonDiagramExportOptions | null,
): Uint8Array {
  const layout = layoutSheet(model.sideM, scale);
  return buildLayeredNativeAi(
    layout.pageWidthMm,
    layout.pageHeightMm,
    figureGroundChunks(model, scale, style ?? readDrawingStyle(), heliodon),
    FIGURE_LAYER_ORDER,
    titleLine(model, layout),
  );
}

export async function sitePlanAi(
  model: CityModel,
  scale: number,
  style?: LineStyles,
  exportOptions?: SitePlanExportOptions | HeliodonDiagramExportOptions | null,
): Promise<Uint8Array> {
  if (useNativeAi8Export()) return sitePlanAi8(model, scale, style, exportOptions);
  if (import.meta.env.VITE_CITYCUT_AI_PDF_OPS === "true") {
    const layout = layoutSheet(model.sideM, scale);
    const chunks = sitePlanChunks(model, scale, style ?? readDrawingStyle(), exportOptions);
    return buildLayeredNativeAiPdfOps(
      layout.pageWidthMm,
      layout.pageHeightMm,
      chunks,
      sitePlanLayerOrder(chunks),
      titleLine(model, layout),
    );
  }
  return sitePlanPdf(model, scale, style, exportOptions);
}

export async function figureGroundAi(
  model: CityModel,
  scale: number,
  style?: LineStyles,
  heliodon?: HeliodonDiagramExportOptions | null,
): Promise<Uint8Array> {
  if (useNativeAi8Export()) return figureGroundAi8(model, scale, style, heliodon);
  if (import.meta.env.VITE_CITYCUT_AI_PDF_OPS === "true") {
    const layout = layoutSheet(model.sideM, scale);
    return buildLayeredNativeAiPdfOps(
      layout.pageWidthMm,
      layout.pageHeightMm,
      figureGroundChunks(model, scale, style ?? readDrawingStyle(), heliodon),
      FIGURE_LAYER_ORDER,
      titleLine(model, layout),
    );
  }
  return figureGroundPdf(model, scale, style, heliodon);
}
