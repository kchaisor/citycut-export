import { openRing } from "./geo";
import type { CityModel, Pt } from "../types";

const round = (value: number) => Math.round(value * 10) / 10;

function move(points: Pt[]): string {
  const opened = openRing(points);
  if (opened.length < 2) return "";
  return opened
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(point[0])} ${round(-point[1])}`)
    .join(" ");
}

function polygonPath(ring: Pt[], holes: Pt[][]): string {
  const outer = move(ring);
  if (!outer) return "";
  const inner = holes.map((hole) => move(hole)).filter(Boolean).map((path) => `${path} Z`).join(" ");
  return `${outer} Z${inner ? ` ${inner}` : ""}`;
}

export type PlanPaths = {
  green: string[];
  water: string[];
  roads: { d: string; width: number }[];
  rails: { d: string; width: number }[];
  buildings: string[];
};

export function planPaths(model: CityModel): PlanPaths {
  const green: string[] = [];
  const water: string[] = [];
  for (const area of model.areas) {
    const path = polygonPath(area.ring, area.holes);
    if (!path) continue;
    if (area.kind === "water") water.push(path);
    else green.push(path);
  }
  const roads: PlanPaths["roads"] = [];
  const rails: PlanPaths["rails"] = [];
  for (const road of model.roads) {
    const d = move(road.line);
    if (!d) continue;
    const width = Math.max(road.width, road.kind === "rail" ? 2.4 : 2.2);
    if (road.kind === "rail") rails.push({ d, width });
    else roads.push({ d, width });
  }
  const buildings = model.buildings
    .map((building) => polygonPath(building.ring, building.holes))
    .filter(Boolean);
  return { green, water, roads, rails, buildings };
}

export function sitePlanSvg(model: CityModel): string {
  const half = model.sideM / 2;
  const pad = model.sideM * 0.04;
  const view = `${round(-half - pad)} ${round(-half - pad)} ${round(model.sideM + pad * 2)} ${round(model.sideM + pad * 2)}`;
  const paths = planPaths(model);
  const green = paths.green.map((d) => `<path d="${d}" fill="#b7d39a"/>`).join("");
  const water = paths.water.map((d) => `<path d="${d}" fill="#9ec9d1"/>`).join("");
  const roads = paths.roads
    .map(
      (road) =>
        `<path d="${road.d}" fill="none" stroke="#c3b6a4" stroke-width="${round(road.width)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  const rails = paths.rails
    .map(
      (rail) =>
        `<path d="${rail.d}" fill="none" stroke="#8d6244" stroke-width="${round(rail.width)}" stroke-dasharray="${round(rail.width * 1.6)} ${round(rail.width)}" stroke-linecap="butt"/>`,
    )
    .join("");
  const buildings = paths.buildings
    .map((d) => `<path d="${d}" fill="#1c1b17" fill-rule="evenodd"/>`)
    .join("");
  const title = `CityCut ${model.placeLabel} ${model.center.lat.toFixed(5)}, ${model.center.lon.toFixed(5)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="1400" height="1400">
  <title>${escapeXml(title)}</title>
  <desc>${escapeXml(model.sourceNote)} © OpenStreetMap contributors.</desc>
  <rect x="${round(-half - pad)}" y="${round(-half - pad)}" width="${round(model.sideM + pad * 2)}" height="${round(model.sideM + pad * 2)}" fill="#e7e2d8"/>
  <rect x="${round(-half)}" y="${round(-half)}" width="${round(model.sideM)}" height="${round(model.sideM)}" fill="#f6f3ec"/>
  ${green}
  ${water}
  ${roads}
  ${rails}
  ${buildings}
  <rect x="${round(-half)}" y="${round(-half)}" width="${round(model.sideM)}" height="${round(model.sideM)}" fill="none" stroke="#1c1b17" stroke-width="${round(model.sideM * 0.004)}"/>
  <text x="0" y="${round(-half + model.sideM * 0.035)}" text-anchor="middle" font-family="Georgia, serif" font-size="${round(model.sideM * 0.028)}" fill="#1c1b17">N</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
