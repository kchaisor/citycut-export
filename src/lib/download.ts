import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { buildCityGroup, disposeObject } from "./buildCity";
import { sitePlanSvg } from "./svgPlan";
import type { CityModel } from "../types";

export function fileStem(model: CityModel): string {
  const lat = `${Math.abs(model.center.lat).toFixed(4)}${model.center.lat < 0 ? "S" : "N"}`;
  const lon = `${Math.abs(model.center.lon).toFixed(4)}${model.center.lon < 0 ? "W" : "E"}`;
  return `citycut-${lat}-${lon}-${Math.round(model.sideM)}m`;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadSvg(model: CityModel) {
  const svg = sitePlanSvg(model);
  downloadBlob(
    `${fileStem(model)}.svg`,
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
}

export async function downloadGlb(model: CityModel): Promise<void> {
  const group = buildCityGroup(model);
  try {
    const exporter = new GLTFExporter();
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        group,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error("CityCut expected a binary glTF."));
        },
        (error) => reject(error),
        { binary: true },
      );
    });
    downloadBlob(
      `${fileStem(model)}.glb`,
      new Blob([buffer], { type: "model/gltf-binary" }),
    );
  } finally {
    disposeObject(group);
  }
}
