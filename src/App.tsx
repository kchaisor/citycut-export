import { lazy, Suspense, useRef, useState } from "react";
import { FaqDialog } from "./components/FaqDialog";
import { MapStage, type FlyRequest } from "./components/MapStage";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import {
  DEFAULT_LAYERS,
  DEFAULT_SIDE_KM,
  DEFAULT_ZOOM,
  MAX_AREA_M2,
  MELBOURNE,
  MELBOURNE_LABEL,
} from "./content/constants";
import { M_PER_DEG_LAT, mPerDegLon, squareBBox } from "./lib/geo";
import { buildOverpassQuery, fetchOverpass, overpassBBox } from "./lib/overpass";
import { parseCity } from "./lib/parseOsm";
import type { Basemap, CityModel, PlaceHit, UiLayers, ViewState } from "./types";

const ModelPage = lazy(() => import("./components/ModelPage").then((mod) => ({ default: mod.ModelPage })));

export default function App() {
  const initialView: ViewState = { ...MELBOURNE, zoom: DEFAULT_ZOOM };
  const viewRef = useRef<ViewState>(initialView);
  const pinRef = useRef(MELBOURNE);
  const pinLabelRef = useRef(MELBOURNE_LABEL);
  const driftedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const [sideKm, setSideKm] = useState(DEFAULT_SIDE_KM);
  const [layers, setLayers] = useState<UiLayers>(DEFAULT_LAYERS);
  const [basemap, setBasemap] = useState<Basemap>("map");
  const [placeLabel, setPlaceLabel] = useState(MELBOURNE_LABEL);
  const [fly, setFly] = useState<FlyRequest | null>(null);
  const [phase, setPhase] = useState<"select" | "model">("select");
  const [model, setModel] = useState<CityModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faq, setFaq] = useState(false);

  function onView(view: ViewState) {
    viewRef.current = view;
    const dx = (view.lon - pinRef.current.lon) * mPerDegLon(view.lat);
    const dy = (view.lat - pinRef.current.lat) * M_PER_DEG_LAT;
    const drifted = Math.hypot(dx, dy) > 450;
    if (drifted !== driftedRef.current) {
      driftedRef.current = drifted;
      setPlaceLabel(drifted ? "Selected frame" : pinLabelRef.current);
    }
  }

  function onLayer(key: keyof UiLayers, on: boolean) {
    setLayers((current) => ({ ...current, [key]: on }));
    if (key === "satellite") setBasemap(on ? "satellite" : "map");
    setError(null);
  }

  function onBasemap(next: Basemap) {
    setBasemap(next);
    setLayers((current) => ({ ...current, satellite: next === "satellite" }));
  }

  function onPlace(place: PlaceHit) {
    pinRef.current = { lon: place.lon, lat: place.lat };
    pinLabelRef.current = place.label;
    driftedRef.current = false;
    setPlaceLabel(place.label);
    setFly({
      token: Date.now(),
      lon: place.lon,
      lat: place.lat,
      bounds: place.bounds,
    });
  }

  function focusMelbourne() {
    pinRef.current = MELBOURNE;
    pinLabelRef.current = MELBOURNE_LABEL;
    driftedRef.current = false;
    setPlaceLabel(MELBOURNE_LABEL);
    setFly({
      token: Date.now(),
      lon: MELBOURNE.lon,
      lat: MELBOURNE.lat,
      zoom: DEFAULT_ZOOM,
      bounds: null,
    });
  }

  function onHome() {
    if (phase === "model") {
      setPhase("select");
      return;
    }
    focusMelbourne();
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }

  async function createModel() {
    const view = viewRef.current;
    const sideM = sideKm * 1000;
    const modelLayers = {
      buildings: layers.buildings,
      roads: layers.roads,
      waterGreen: layers.waterGreen,
    };
    if (!modelLayers.buildings && !modelLayers.roads && !modelLayers.waterGreen) {
      setError("Turn on Buildings, Roads and rail, or Water and green.");
      return;
    }
    if (sideM * sideM > MAX_AREA_M2 + 1) {
      setError("That frame is over the 2 km² limit for this version.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const query = buildOverpassQuery(overpassBBox(squareBBox(view, sideM)), modelLayers);
      const data = await fetchOverpass(query, controller.signal);
      const parsed = parseCity(data, { lon: view.lon, lat: view.lat }, sideM, modelLayers);
      setModel({ ...parsed, placeLabel });
      setPhase("model");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Could not build the model.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <div className="app">
      <TopBar
        showNewCut={phase === "model"}
        onHome={onHome}
        onNewCut={() => setPhase("select")}
        onFaq={() => setFaq(true)}
      />
      {phase === "select" ? (
        <div className="select">
          <MapStage
            basemap={basemap}
            sideM={sideKm * 1000}
            initialView={viewRef.current}
            fly={fly}
            loading={loading}
            onCancel={cancel}
            onView={onView}
            onBasemap={onBasemap}
          />
          <Sidebar
            placeLabel={placeLabel}
            sideKm={sideKm}
            layers={layers}
            loading={loading}
            error={error}
            onSideKm={setSideKm}
            onLayer={onLayer}
            onPlace={onPlace}
            onCreate={createModel}
          />
        </div>
      ) : model ? (
        <Suspense fallback={<p className="opening">Opening the model…</p>}>
          <ModelPage model={model} />
        </Suspense>
      ) : null}
      <FaqDialog open={faq} onClose={() => setFaq(false)} />
    </div>
  );
}
