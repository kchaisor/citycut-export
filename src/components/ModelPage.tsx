import { useState } from "react";
import { FAQ } from "../content/faq";
import { formatCoord, formatLengthKm } from "../lib/geo";
import { downloadGlb, downloadSvg } from "../lib/download";
import type { CityModel } from "../types";
import { DrawingPlan } from "./DrawingPlan";
import { SatellitePane } from "./SatellitePane";
import { Scene3D } from "./Scene3D";
import { SceneBoundary } from "./SceneBoundary";

type Tab = "3d" | "drawing" | "satellite";

export function ModelPage({ model }: { model: CityModel }) {
  const [tab, setTab] = useState<Tab>("3d");
  const [exportError, setExportError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"glb" | "svg" | null>(null);
  const sideKm = model.sideM / 1000;
  const layerBits = [
    model.layers.buildings ? "buildings" : null,
    model.layers.roads ? "roads and rail" : null,
    model.layers.waterGreen ? "water and green" : null,
  ].filter(Boolean);

  async function saveGlb() {
    setExportError(null);
    setBusy("glb");
    try {
      await downloadGlb(model);
    } catch {
      setExportError("The glTF file could not be written.");
    } finally {
      setBusy(null);
    }
  }

  function saveSvg() {
    setExportError(null);
    setBusy("svg");
    try {
      downloadSvg(model);
    } catch {
      setExportError("The SVG file could not be written.");
    } finally {
      setBusy(null);
    }
  }

  const hint =
    tab === "3d"
      ? "Drag to orbit · scroll to zoom · right-drag to pan"
      : tab === "drawing"
        ? "Scroll to zoom · drag to pan · double-click to fit"
        : "Satellite preview of this frame. It is not saved in the glTF.";

  return (
    <div className="model">
      <div className="model-inner">
        <div className="model-head">
          <div>
            <h1>Your model is ready.</h1>
            <p className="meta">
              {model.placeLabel} · {formatCoord(model.center.lat)}, {formatCoord(model.center.lon)} ·{" "}
              {Math.round(model.sideM)} × {Math.round(model.sideM)} m
            </p>
            <p className="meta">{model.sourceNote}</p>
          </div>
          <dl className="stats">
            {model.layers.buildings && (
              <div>
                <dt>Buildings</dt>
                <dd>{model.buildings.length.toLocaleString()}</dd>
              </div>
            )}
            {model.layers.roads && (
              <div>
                <dt title="Clipped centerline length of roads, paths, and rail">Roads, km</dt>
                <dd>{formatLengthKm(model.roadKm)}</dd>
              </div>
            )}
            <div>
              <dt>Area</dt>
              <dd>{(sideKm * sideKm).toFixed(2)} km²</dd>
            </div>
          </dl>
        </div>

        <div className="tabs" role="tablist" aria-label="Model views">
          {(
            [
              ["3d", "3D model"],
              ["drawing", "Drawing"],
              ["satellite", "Satellite"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="viewport">
          <div className="fill">
            {tab === "3d" && (
              <SceneBoundary>
                <Scene3D model={model} />
              </SceneBoundary>
            )}
            {tab === "drawing" && <DrawingPlan model={model} />}
            {tab === "satellite" && <SatellitePane model={model} />}
          </div>
          <p className="viewport-hint">{hint}</p>
        </div>

        <div className="exports">
          <article className="card">
            <div>
              <h2>
                glTF <span>.glb</span>
              </h2>
              <p>Buildings, roads, water, and green as a mesh. Flat ground, no textures.</p>
            </div>
            <button className="ghost" type="button" disabled={busy !== null} onClick={saveGlb}>
              {busy === "glb" ? "Preparing…" : "Download"}
            </button>
          </article>
          <article className="card">
            <div>
              <h2>
                Site plan <span>.svg</span>
              </h2>
              <p>The same block as vectors: building fills, road lines, water, and green.</p>
            </div>
            <button className="ghost" type="button" disabled={busy !== null} onClick={saveSvg}>
              {busy === "svg" ? "Preparing…" : "Download"}
            </button>
          </article>
        </div>
        <p className="v2">
          This file includes {layerBits.join(", ") || "an empty block"}. DXF, DAE, 3DM, and JPG are
          not available in this version.
        </p>
        {exportError && (
          <p className="error" role="alert">
            {exportError}
          </p>
        )}

        <section className="faq-block" aria-labelledby="model-faq">
          <h2 id="model-faq">FAQ</h2>
          <div className="faq-list">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
        <footer className="page-foot">
          Map data © OpenStreetMap contributors. Satellite imagery © Esri, Maxar, Earthstar
          Geographics, and the GIS User Community. CityCut · Kelvin Chai.
        </footer>
      </div>
    </div>
  );
}
