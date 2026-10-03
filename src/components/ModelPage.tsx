import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Download, DraftingCompass, Info, Sun, Trees } from "lucide-react";
import {
  BUILDING_USES,
  BUILDING_USE_META,
  SOURCE_COUNT_KEYS,
  SOURCE_META,
  countSources,
  countUses,
  uniformBuildingColor,
} from "../lib/buildingUse";
import { useColourRevision } from "../lib/useColourRevision";
import { CRS_NOTE, mgaCrs } from "../lib/crs";
import {
  commitLineStyles,
  lineStyleBaseline,
  readDrawingStyle,
  resetStoredLineStyles,
  type LineStyles,
} from "../lib/drawingStyle";
import {
  download3dm,
  downloadBlob,
  downloadFigureAi,
  downloadSiteAi,
  downloadViewAi,
  pngFilename,
} from "../lib/download";
import { FIGURE_SCALES, preferredFigureScale, sheetFitMessage } from "../lib/figureGround";
import {
  fetchComBuildingFootprints,
  paddedComFetchBounds,
  type ComBuildingFootprint,
} from "../lib/comBuildingHeights";
import { runComBuildingHeightsInWorker } from "../lib/comBuildingHeightsWorkerClient";
import {
  COM_BUILDING_HEIGHTS_CREDIT,
  COM_BUILDING_HEIGHTS_DATASET_URL,
} from "../lib/comBuildingHeightCredit";
import {
  readStoredComBuildingHeights,
  writeStoredComBuildingHeights,
} from "../lib/comBuildingHeightsToggle";
import { formatCoord, formatLengthKm } from "../lib/geo";
import { ISO_CORNERS, type IsoCorner } from "../lib/isoCamera";
import { drawerIsAvailable, loadModelDrawer, reduceRail, saveModelDrawer } from "../lib/railState";
import { capturePresetFromSearch } from "../lib/captureQuery";
import {
  resolveView,
  VIEW_STORAGE_KEY,
  writeStoredView,
  writeViewSearch,
  type ViewMemory,
} from "../lib/viewMemory";
import { treeSizeSummary, treeTierCounts } from "../lib/trees";
import { contourDrawerLabel } from "../lib/vicmapContours";
import { VICMAP_ATTRIBUTION } from "../lib/vicmapTrees";
import type { CityModel } from "../types";
import { ColoursEditor } from "./Colours";
import { Drawer } from "./Drawer";
import { DrawingPlan, type DrawingKind } from "./DrawingPlan";
import { LineStylesEditor } from "./LineStyles";
import { IconRail, type RailItem } from "./IconRail";
import { SatellitePane } from "./SatellitePane";
import { Scene3D, type SceneExporter } from "./Scene3D";
import { SceneBoundary } from "./SceneBoundary";
import { SolarPanel } from "./SolarPanel";
import type { SitePlanExportOptions } from "../lib/aiPlan";
import type { PlanShadowInput } from "../lib/buildingShadows";
import type { HeliodonDiagramExportOptions, HeliodonGroundExportOptions } from "../lib/heliodonDiagram";
import {
  readStoredHeliodonRadiusFactor,
  resolveHeliodonRadiusFactor,
  writeStoredHeliodonRadiusFactor,
} from "../lib/heliodonRadius";
import type { SolarViewSettings } from "./SolarHeliodon";

type Tab = "3d" | "drawing" | "satellite";

const DRAWER_ID = "model-drawer";
const iconProps = { size: 18, strokeWidth: 1.75, "aria-hidden": true as const };

const CORNER_LABEL: Record<IsoCorner, string> = {
  ne: "NE",
  nw: "NW",
  se: "SE",
  sw: "SW",
};

function loadView(): ViewMemory {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    stored = null;
  }
  return resolveView(stored, window.location.search);
}

const TITLES: Record<string, string> = {
  summary: "Model details",
  buildings: "Buildings",
  trees: "Tree sizes",
  drawing: "Drawing",
  solar: "Solar",
  exports: "Exports",
};

export function ModelPage({ model }: { model: CityModel }) {
  const [tab, setTab] = useState<Tab>("3d");
  const [drawing, setDrawing] = useState<DrawingKind>("site");
  const [lineStyles, setLineStyles] = useState<LineStyles>(() => readDrawingStyle());
  useColourRevision();
  const uniform = uniformBuildingColor();
  const [figureScale, setFigureScale] = useState<number>(() => preferredFigureScale(model.sideM));
  const [exportError, setExportError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"3dm" | "png" | "ai-view" | "ai-site" | "ai-figure" | null>(null);
  const [colourByUse, setColourByUse] = useState(
    () => !capturePresetFromSearch(window.location.search).uniformBuildings,
  );
  const [showSource, setShowSource] = useState(false);
  const [betterHeights, setBetterHeights] = useState(() =>
    readStoredComBuildingHeights(window.localStorage),
  );
  const [comFootprints, setComFootprints] = useState<ComBuildingFootprint[]>([]);
  const [preferred, setPreferred] = useState<string | null>(() => loadModelDrawer());
  const [planWidth, setPlanWidth] = useState<number | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [view, setView] = useState<ViewMemory>(loadView);
  const [snapId, setSnapId] = useState(0);
  const [solar, setSolar] = useState<SolarViewSettings>(() => ({
    showPath: capturePresetFromSearch(window.location.search).solarPath,
    castShadows: false,
    radiusFactor: resolveHeliodonRadiusFactor(
      readStoredHeliodonRadiusFactor(window.localStorage),
      window.location.search,
    ),
    year: 2026,
    month: 9,
    day: 22,
    hour: 15,
    minute: 0,
  }));

  function commitSolar(next: SolarViewSettings) {
    writeStoredHeliodonRadiusFactor(window.localStorage, next.radiusFactor);
    if (next.showPath !== solar.showPath || next.radiusFactor !== solar.radiusFactor) {
      setSnapId((id) => id + 1);
    }
    setSolar(next);
  }

  function planShadowInput(): PlanShadowInput {
    return {
      lat: model.center.lat,
      lon: model.center.lon,
      year: solar.year,
      month: solar.month,
      day: solar.day,
      hour: solar.hour,
      minute: solar.minute,
    };
  }

  function heliodonDiagramExport(): HeliodonDiagramExportOptions | null {
    if (!solar.showPath) return null;
    return {
      ...planShadowInput(),
      sideM: model.sideM,
      radiusFactor: solar.radiusFactor,
    };
  }

  function sitePlanExportOptions(): SitePlanExportOptions {
    return {
      heliodon: heliodonDiagramExport(),
      shadows: planShadowInput(),
      castShadows: solar.castShadows,
    };
  }

  function heliodonRhinoExport(): HeliodonGroundExportOptions | null {
    if (!solar.showPath) return null;
    return { ...heliodonDiagramExport()!, radiusFactor: solar.radiusFactor };
  }
  const exportRef = useRef<SceneExporter | null>(null);
  const onExportReady = useCallback((exporter: SceneExporter | null) => {
    exportRef.current = exporter;
  }, []);
  const onScale = useCallback((widthM: number) => setPlanWidth(widthM), []);
  useEffect(() => {
    writeStoredView(window.localStorage, loadView());
  }, []);

  useEffect(() => {
    if (!betterHeights || !model.layers.buildings) {
      setComFootprints([]);
      return;
    }
    const bounds = paddedComFetchBounds(model.center, model.sideM);
    const controller = new AbortController();
    fetchComBuildingFootprints(bounds, model.center, controller.signal)
      .then((footprints) => {
        setComFootprints(footprints);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setComFootprints([]);
        }
      });
    return () => controller.abort();
  }, [betterHeights, model.center.lat, model.center.lon, model.sideM, model.layers.buildings]);

  const [comHeightBuildings, setComHeightBuildings] = useState<typeof model.buildings | null>(null);
  const [comHeightUpdates, setComHeightUpdates] = useState(0);

  useEffect(() => {
    if (!betterHeights || comFootprints.length === 0 || model.buildings.length === 0) {
      setComHeightBuildings(null);
      setComHeightUpdates(0);
      return;
    }
    const controller = new AbortController();
    runComBuildingHeightsInWorker(model.buildings, comFootprints, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setComHeightBuildings(result.buildings);
        setComHeightUpdates(result.updated);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setComHeightBuildings(null);
          setComHeightUpdates(0);
        }
      });
    return () => controller.abort();
  }, [betterHeights, comFootprints, model.buildings]);

  const displayBuildings =
    betterHeights && comHeightBuildings ? comHeightBuildings : model.buildings;

  const displayModel = useMemo(
    () => ({
      ...model,
      buildings: displayBuildings,
      comBuildingHeights: betterHeights,
    }),
    [model, displayBuildings, betterHeights],
  );
  const crs = mgaCrs(model.center.lon);
  const sideKm = model.sideM / 1000;
  const tierCounts = treeTierCounts(model.trees);
  const showBuildings = model.layers.buildings && model.buildings.length > 0;
  const showTrees = model.layers.trees && model.trees.length > 0;
  const layerBits = [
    model.layers.buildings ? "buildings" : null,
    model.layers.roads ? "roads and rail" : null,
    model.layers.waterGreen ? "water and green" : null,
    model.layers.trees ? "trees" : null,
    model.terrain ? "terrain" : null,
  ].filter(Boolean);

  const items: RailItem[] = [
    { id: "summary", label: "Model details", icon: <Info {...iconProps} /> },
  ];
  if (showBuildings) items.push({ id: "buildings", label: "Buildings", icon: <Building2 {...iconProps} /> });
  if (showTrees) items.push({ id: "trees", label: "Tree sizes", icon: <Trees {...iconProps} /> });
  items.push(
    { id: "drawing", label: "Drawing", icon: <DraftingCompass {...iconProps} /> },
    { id: "solar", label: "Solar", icon: <Sun {...iconProps} /> },
    { id: "exports", label: "Exports", icon: <Download {...iconProps} /> },
  );
  const open = drawerIsAvailable(preferred, items.map((item) => item.id));

  function toggle(id: string) {
    const next = reduceRail(preferred, { type: "toggle", id });
    saveModelDrawer(next);
    setPreferred(next);
  }

  function close() {
    const next = reduceRail(preferred, { type: "close" });
    saveModelDrawer(next);
    setPreferred(next);
  }

  function commitView(next: ViewMemory, snap: boolean) {
    setView(next);
    writeStoredView(window.localStorage, next);
    const search = writeViewSearch(window.location.search, next);
    const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== current) window.history.replaceState(window.history.state, "", nextUrl);
    if (snap) setSnapId((id) => id + 1);
  }

  async function save3dm() {
    setExportError(null);
    setBusy("3dm");
    try {
      await download3dm(displayModel, {
        heliodon: heliodonRhinoExport(),
        shadows: planShadowInput(),
        castShadows: solar.castShadows,
      });
    } catch {
      setExportError("The Rhino file could not be written.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSiteAi() {
    setExportError(null);
    setBusy("ai-site");
    try {
      await downloadSiteAi(displayModel, figureScale, lineStyles, sitePlanExportOptions());
    } catch {
      setExportError("The site plan could not be written.");
    } finally {
      setBusy(null);
    }
  }

  async function saveFigureAi() {
    setExportError(null);
    setBusy("ai-figure");
    try {
      await downloadFigureAi(displayModel, figureScale, lineStyles, heliodonDiagramExport());
    } catch {
      setExportError("The figure-ground file could not be written.");
    } finally {
      setBusy(null);
    }
  }

  async function saveViewAi() {
    setExportError(null);
    setBusy("ai-view");
    try {
      const exporter = exportRef.current;
      if (!exporter) throw new Error("The 3D view is not ready.");
      await downloadViewAi(displayModel, exporter.shot(), {
        uniformBuildings: !colourByUse && !showSource,
        colourBySource: showSource,
      });
    } catch (error) {
      console.error(error);
      setExportError("The 3D view could not be written.");
    } finally {
      setBusy(null);
    }
  }

  async function savePng() {
    setExportError(null);
    setBusy("png");
    try {
      const exporter = exportRef.current;
      if (!exporter) throw new Error("The 3D view is not ready.");
      const blob = await exporter.png();
      downloadBlob(pngFilename(model), blob);
    } catch {
      setExportError("The PNG image could not be written.");
    } finally {
      setBusy(null);
    }
  }

  const figureFit = sheetFitMessage(model.sideM, figureScale);
  const useCounts = countUses(model.buildings);
  const sourceCounts = countSources(model.buildings);
  const hint =
    tab === "3d"
      ? view.projection === "plan"
        ? "Drag to pan · scroll to zoom · north up · orthographic"
        : view.projection === "perspective"
          ? "Drag to orbit · scroll to zoom · right-drag to pan"
          : view.freeRotate
            ? "Drag to orbit · scroll to zoom · right-drag to pan · not true isometric"
            : "Drag to pan · scroll to zoom"
      : tab === "drawing"
        ? "Scroll to zoom · drag to pan · double-click to fit"
        : "Satellite preview of this frame. It is not included in the downloads.";

  return (
    <div className="model">
      <h1 className="sr-only">Your model is ready.</h1>
      <div className={tab === "drawing" ? "viewport is-drawing" : "viewport"}>
        {tab === "3d" && (
          <div className="fill">
            <SceneBoundary>
              <Scene3D
                model={displayModel}
                uniformBuildings={!colourByUse && !showSource}
                colourBySource={showSource}
                projection={view.projection}
                corner={view.corner}
                freeRotate={view.freeRotate}
                snapId={snapId}
                solar={solar}
                onExportReady={onExportReady}
              />
            </SceneBoundary>
          </div>
        )}
        {tab === "drawing" && (
          <div className="fill is-plan">
            <DrawingPlan
              key={fitToken}
              model={model}
              kind={drawing}
              onScale={onScale}
              lineStyle={lineStyles}
              planScale={figureScale}
              heliodon={heliodonDiagramExport()}
              castShadows={solar.castShadows}
              shadowInput={planShadowInput()}
            />
          </div>
        )}
        {tab === "satellite" && (
          <div className="fill">
            <SatellitePane model={model} />
          </div>
        )}
        <div className="chrome model-chrome">
          <IconRail items={items} openId={open} onToggle={toggle} label="Model tools" drawerId={DRAWER_ID} />
          <Drawer id={DRAWER_ID} open={open !== null} title={TITLES[open ?? "summary"] ?? "Model details"} onClose={close}>
            <div className="drawer-section" hidden={open !== "summary"}>
              <p className="ready-title">Your model is ready.</p>
              <p className="meta">
                {model.placeLabel} · {formatCoord(model.center.lat)}, {formatCoord(model.center.lon)} ·{" "}
                {Math.round(model.sideM)} × {Math.round(model.sideM)} m
              </p>
              <p className="meta">{model.sourceNote}</p>
              {model.terrainError && <p className="error">{model.terrainError}</p>}
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
                {model.layers.trees && (
                  <div>
                    <dt>Trees</dt>
                    <dd>{model.trees.length.toLocaleString()}</dd>
                  </div>
                )}
                {model.terrain && (
                  <div>
                    <dt>Elevation, m</dt>
                    <dd>
                      {model.terrain.min.toFixed(0)}–{model.terrain.max.toFixed(0)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Area</dt>
                  <dd>{(sideKm * sideKm).toFixed(2)} km²</dd>
                </div>
              </dl>
            </div>

            {showBuildings && (
              <div className="drawer-section legend" hidden={open !== "buildings"}>
                <div className="panel-toolbar">
                  <button
                    type="button"
                    data-autofocus="true"
                    aria-pressed={colourByUse && !showSource}
                    onClick={() => {
                      setShowSource(false);
                      setColourByUse((on) => !on);
                    }}
                  >
                    {colourByUse ? "Uniform colour" : "Colour by use"}
                  </button>
                  <button type="button" aria-pressed={showSource} onClick={() => setShowSource((on) => !on)}>
                    {showSource ? "Showing source" : "Show source"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={betterHeights}
                    onClick={() => {
                      setBetterHeights((on) => {
                        const next = !on;
                        writeStoredComBuildingHeights(window.localStorage, next);
                        return next;
                      });
                    }}
                  >
                    {betterHeights ? "Better heights (CoM 2023) on" : "Better heights (CoM 2023)"}
                  </button>
                </div>
                {betterHeights && comHeightUpdates > 0 && (
                  <p className="legend-note">
                    {comHeightUpdates.toLocaleString()} building{comHeightUpdates === 1 ? "" : "s"} use City of
                    Melbourne extrusion heights in this frame.
                  </p>
                )}
                {betterHeights && (
                  <p className="legend-note">
                    <a href={COM_BUILDING_HEIGHTS_DATASET_URL}>{COM_BUILDING_HEIGHTS_CREDIT}</a>
                  </p>
                )}
                {solar.showPath && tab === "3d" && (
                  <p className="legend-note">Buildings render white on screen while sun path is on; exports keep normal colours.</p>
                )}
                <ul>
                  {BUILDING_USES.filter((use) => useCounts[use] > 0).map((use) => (
                    <li key={use}>
                      <i
                        style={{
                          background: colourByUse && !showSource ? BUILDING_USE_META[use].color : uniform,
                        }}
                      />
                      <span>{BUILDING_USE_META[use].label}</span>
                      <b>{useCounts[use].toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
                <p className="legend-sub">Source</p>
                <ul>
                  {SOURCE_COUNT_KEYS.map((source) => (
                    <li key={source}>
                      <i
                        className={SOURCE_META[source].inferred ? "hatch" : undefined}
                        style={{
                          backgroundColor: showSource ? SOURCE_META[source].color : uniform,
                        }}
                      />
                      <span>{SOURCE_META[source].label}</span>
                      <b>{sourceCounts[source].toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
                {model.useTierFailures?.map((failure) => (
                  <p key={failure.tier} className="legend-note">
                    {failure.message}
                  </p>
                ))}
              </div>
            )}

            {showTrees && (
              <div className="drawer-section tree-sizes" hidden={open !== "trees"}>
                <ul className="tree-tiers">
                  {(
                    [
                      ["com", "City of Melbourne"],
                      ["osm", "OpenStreetMap"],
                      ["vicmap", "Vicmap"],
                      ["canopy", "Canopy infill"],
                    ] as const
                  ).map(([tier, label]) => (
                    <li key={tier}>
                      <span>{label}</span>
                      <b>{tierCounts[tier].toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
                <p className="tree-readout">{treeSizeSummary(model.trees)}</p>
                {model.treeCapHit && (
                  <p className="legend-note">
                    Tree count was capped at 8,000. Canopy infill was trimmed first, then Vicmap.
                  </p>
                )}
                {tierCounts.vicmap > 0 && <p className="tree-credit">{VICMAP_ATTRIBUTION}</p>}
              </div>
            )}

            <div className="drawer-section" hidden={open !== "drawing"}>
              <div className="tabs" role="tablist" aria-label="Model views">
                {(
                  [
                    ["3d", "3D model"],
                    ["drawing", "Drawing"],
                    ["satellite", "Satellite"],
                  ] as const
                ).map(([id, label], index) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    data-autofocus={index === 0 ? "true" : undefined}
                    aria-selected={tab === id}
                    className={tab === id ? "active" : ""}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "3d" && (
                <div className="projection-block">
                  <p className="kicker">Projection</p>
                  <div className="plan-switch" role="group" aria-label="Projection">
                    <button
                      type="button"
                      aria-pressed={view.projection === "perspective"}
                      onClick={() => commitView({ ...view, projection: "perspective" }, false)}
                    >
                      Perspective
                    </button>
                    <button
                      type="button"
                      aria-pressed={view.projection === "iso"}
                      onClick={() => commitView({ ...view, projection: "iso" }, false)}
                    >
                      Isometric
                    </button>
                    <button
                      type="button"
                      aria-pressed={view.projection === "plan"}
                      onClick={() => commitView({ projection: "plan", corner: view.corner, freeRotate: false }, true)}
                    >
                      Plan, north-up
                    </button>
                  </div>
                  {view.projection === "plan" && (
                    <p className="field-note">Orthographic plan view. Choose Perspective to return to the 3D orbit camera.</p>
                  )}
                  {view.projection === "iso" && (
                    <>
                      <p className="kicker">Corner</p>
                      <div className="plan-switch" role="group" aria-label="Isometric corner">
                        {ISO_CORNERS.map((corner) => (
                          <button
                            key={corner}
                            type="button"
                            aria-pressed={view.corner === corner && !view.freeRotate}
                            onClick={() => commitView({ projection: "iso", corner, freeRotate: false }, true)}
                          >
                            {CORNER_LABEL[corner]}
                          </button>
                        ))}
                      </div>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={view.freeRotate}
                          onChange={(event) => {
                            const freeRotate = event.target.checked;
                            commitView({ ...view, projection: "iso", freeRotate }, !freeRotate);
                          }}
                        />
                        Free rotate (axonometric)
                      </label>
                      {view.freeRotate && (
                        <p className="iso-warning">
                          Free rotate is on, so this is no longer a true isometric view. Turn it off, or pick a
                          corner, to lock the true angles again.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              <div className="plan-switch" role="group" aria-label="Drawing type">
                <button
                  type="button"
                  aria-pressed={drawing === "site"}
                  onClick={() => {
                    setDrawing("site");
                    setTab("drawing");
                  }}
                >
                  Site plan
                </button>
                <button
                  type="button"
                  aria-pressed={drawing === "figure-ground"}
                  onClick={() => {
                    setDrawing("figure-ground");
                    setTab("drawing");
                  }}
                >
                  Figure-ground
                </button>
              </div>
              <label className="scale-field">
                Plan scale
                <select
                  value={figureScale}
                  aria-label="Plan scale"
                  onChange={(event) => setFigureScale(Number(event.target.value))}
                >
                  {FIGURE_SCALES.map((scale) => (
                    <option key={scale} value={scale}>
                      1:{scale}
                    </option>
                  ))}
                </select>
              </label>
              {figureFit && <p className="fit-note">{figureFit}</p>}
              {model.contourLayer && (
                <p
                  className="field-note"
                  data-contour-source={model.contourLayer.source}
                  data-contour-features={model.contourLayer.featureCount}
                  data-contour-lines={model.contourLayer.lines.length}
                  data-contour-ms={model.contourLayer.fetchMs}
                  data-contour-interval={model.contourLayer.interval}
                  data-contour-drawn={contourDrawerLabel(
                    model.contourLayer,
                    figureScale,
                    lineStyles.contourCoarseIntervalM,
                    lineStyles.contourCoarseFromScale,
                  )}
                >
                  Contours:{" "}
                  {contourDrawerLabel(
                    model.contourLayer,
                    figureScale,
                    lineStyles.contourCoarseIntervalM,
                    lineStyles.contourCoarseFromScale,
                  )}
                </p>
              )}
              <LineStylesEditor
                style={lineStyles}
                baseline={lineStyleBaseline()}
                onChange={(next) => setLineStyles(commitLineStyles(next, lineStyleBaseline()))}
                onReset={() => setLineStyles(resetStoredLineStyles())}
              />
              <ColoursEditor onChange={() => setLineStyles(readDrawingStyle())} />
              {tab === "drawing" && (
                <div className="field">
                  <div className="field-head">
                    <p className="kicker">View width</p>
                    <strong>{planWidth === null ? "—" : `${Math.round(planWidth)} m`}</strong>
                  </div>
                  <p className="field-note">
                    Width of the drawing in view. The frame is {Math.round(model.sideM)} m on a side.
                  </p>
                  <button className="ghost" type="button" onClick={() => setFitToken((token) => token + 1)}>
                    Fit frame
                  </button>
                </div>
              )}
              {tab === "satellite" && (
                <p className="field-note">Satellite is a preview of this frame. It is not included in the downloads.</p>
              )}
            </div>

            <div className="drawer-section" hidden={open !== "solar"}>
              <SolarPanel embedded settings={solar} onChange={commitSolar} sideM={model.sideM} />
            </div>

            <div className="drawer-section" hidden={open !== "exports"}>
              <div className="exports">
                <article className="card">
                  <div>
                    <h3>
                      PNG image <span>.png</span>
                    </h3>
                    <p>The current 3D view, in perspective or isometric, at twice the canvas resolution.</p>
                  </div>
                  <button className="ghost" type="button" data-autofocus="true" disabled={busy !== null} onClick={savePng} aria-label="Download PNG">
                    {busy === "png" ? "Preparing…" : "Download"}
                  </button>
                </article>
                <article className="card">
                  <div>
                    <h3>
                      Rhino <span>.3dm</span>
                    </h3>
                    <p>The same meshes in {crs.name}, metres, Z-up, plus a FigureGround layer.</p>
                  </div>
                  <button className="ghost" type="button" disabled={busy !== null} onClick={save3dm} aria-label="Download Rhino">
                    {busy === "3dm" ? "Preparing…" : "Download"}
                  </button>
                </article>
                <article className="card">
                  <div>
                    <h3>
                      3D view <span>.ai</span>
                    </h3>
                    <p>The current camera as vectors: filled faces, visible edges, and simplified trees. Not to scale.</p>
                  </div>
                  <button className="ghost" type="button" disabled={busy !== null} onClick={saveViewAi} aria-label="Download 3D view Illustrator">
                    {busy === "ai-view" ? "Preparing…" : "Download"}
                  </button>
                </article>
                <label className="scale-field">
                  Plan scale
                  <select
                    value={figureScale}
                    aria-label="Export plan scale"
                    onChange={(event) => setFigureScale(Number(event.target.value))}
                  >
                    {FIGURE_SCALES.map((scale) => (
                      <option key={scale} value={scale}>
                        1:{scale}
                      </option>
                    ))}
                  </select>
                </label>
                {figureFit && (
                  <p className="fit-note" id="figure-fit">
                    {figureFit}
                  </p>
                )}
                <article className="card">
                  <div>
                    <h3>
                      Site plan <span>.ai</span>
                    </h3>
                    <p>
                      True scale at 1:{figureScale}. Building outlines, the road fill and kerb, contours, and the
                      frame use the line styles on the sheet.
                    </p>
                  </div>
                  <button className="ghost" type="button" disabled={busy !== null} onClick={saveSiteAi} aria-label="Download site plan Illustrator">
                    {busy === "ai-site" ? "Preparing…" : "Download"}
                  </button>
                </article>
                <article className="card">
                  <div>
                    <h3>
                      Figure-ground <span>.ai</span>
                    </h3>
                    <p>Black footprints on white, with the footpath strips, true scale. A3 landscape or portrait, whichever fits the frame.</p>
                  </div>
                  <button className="ghost" type="button" disabled={busy !== null} onClick={saveFigureAi} aria-label="Download figure-ground Illustrator">
                    {busy === "ai-figure" ? "Preparing…" : "Download"}
                  </button>
                </article>
              </div>
              <p className="v2">
                This file includes {layerBits.join(", ") || "an empty block"}. DXF, DAE, and JPG are not available in
                this version.
              </p>
              <p className="v2">{CRS_NOTE}</p>
              {exportError && (
                <p className="error" role="alert">
                  {exportError}
                </p>
              )}
            </div>
          </Drawer>
        </div>
        {model.terrainError && (
          <p className="stage-error" role="alert">
            {model.terrainError}
          </p>
        )}
        <p className="viewport-hint">{hint}</p>
        <p className="stage-attrib">
          Map data © OpenStreetMap contributors. Satellite imagery © Esri, Vantor, Earthstar Geographics, and the GIS
          User Community.
          {model.terrain && (
            <>
              {" "}
              Terrain <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>.
            </>
          )}
          {tierCounts.vicmap > 0 && (
            <>
              {" "}
              <a href="https://discover.data.vic.gov.au/dataset/vicmap-vegetation-tree-urban">
                Vicmap Vegetation Tree Urban
              </a>{" "}
              © State of Victoria (Department of Transport and Planning),{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
            </>
          )}
          {betterHeights && (
            <>
              {" "}
              Building heights:{" "}
              <a href={COM_BUILDING_HEIGHTS_DATASET_URL}>2023 Building Footprints © City of Melbourne</a>,{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
            </>
          )}
          {model.contourLayer && model.contourLayer.source !== "dem" && model.contourLayer.attribution && (
            <>
              {" "}
              <a href={model.contourLayer.datasetUrl ?? "https://discover.data.vic.gov.au/dataset/vicmap-elevation-contour-line-1-to-5-metres-covering-metropolitan-melbourne"}>
                Vicmap Elevation
              </a>{" "}
              © State of Victoria (Department of Transport and Planning),{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/">Creative Commons Attribution 4.0 (CC-BY)</a>.
            </>
          )}{" "}
          CityCut · Kelvin Chai.
        </p>
      </div>
    </div>
  );
}
