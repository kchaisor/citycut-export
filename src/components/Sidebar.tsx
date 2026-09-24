import { useEffect, useId, useRef, useState } from "react";
import { MAX_SIDE_KM, MIN_SIDE_KM } from "../content/constants";
import { searchPlaces } from "../lib/nominatim";
import { formatKmSide } from "../lib/geo";
import type { PlaceHit, UiLayers } from "../types";

const ROWS: { key: keyof UiLayers; label: string; soon?: boolean; hint?: string }[] = [
  { key: "buildings", label: "Buildings" },
  { key: "roads", label: "Roads and rail" },
  { key: "terrain", label: "Terrain", soon: true },
  { key: "contours", label: "Contours", soon: true },
  { key: "waterGreen", label: "Water and green" },
  { key: "trees", label: "Trees", soon: true },
  { key: "satellite", label: "Satellite image", hint: "Basemap only" },
];

export function Sidebar({
  placeLabel,
  sideKm,
  layers,
  loading,
  error,
  onSideKm,
  onLayer,
  onPlace,
  onCreate,
}: {
  placeLabel: string;
  sideKm: number;
  layers: UiLayers;
  loading: boolean;
  error: string | null;
  onSideKm: (km: number) => void;
  onLayer: (key: keyof UiLayers, on: boolean) => void;
  onPlace: (place: PlaceHit) => void;
  onCreate: () => void;
}) {
  const sliderId = useId();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const places = await searchPlaces(text, controller.signal);
        setHits(places);
        setOpen(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        setHits([]);
        setSearchError(err instanceof Error ? "Search is unavailable right now." : "Search failed.");
        setOpen(true);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const soonOn = (["terrain", "contours", "trees"] as const).filter((key) => layers[key]);
  const area = sideKm * sideKm;

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <p className="place-label">{placeLabel}</p>
        <div className="search" ref={boxRef}>
          <label className="sr-only" htmlFor={searchId}>
            Search a place
          </label>
          <input
            id={searchId}
            value={query}
            placeholder="Search a city, address, or place"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls="place-results"
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && hits[0]) {
                event.preventDefault();
                onPlace(hits[0]);
                setQuery(hits[0].label);
                setOpen(false);
              }
              if (event.key === "Escape") setOpen(false);
            }}
          />
          {open && query.trim().length >= 2 && (
            <div className="results" id="place-results" role="listbox">
              {searching && <p className="result-note">Searching…</p>}
              {searchError && <p className="result-note">{searchError}</p>}
              {!searching && !searchError && hits.length === 0 && (
                <p className="result-note">No matches.</p>
              )}
              {hits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  role="option"
                  onClick={() => {
                    onPlace(hit);
                    setQuery(hit.label);
                    setOpen(false);
                  }}
                >
                  <strong>{hit.label}</strong>
                  <span>{hit.detail}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor={sliderId}>Area size</label>
            <strong>
              {formatKmSide(sideKm)} × {formatKmSide(sideKm)} km
            </strong>
          </div>
          <input
            id={sliderId}
            type="range"
            min={MIN_SIDE_KM}
            max={MAX_SIDE_KM}
            step={0.05}
            value={sideKm}
            aria-valuemin={MIN_SIDE_KM}
            aria-valuemax={MAX_SIDE_KM}
            aria-valuenow={sideKm}
            aria-valuetext={`${formatKmSide(sideKm)} kilometres per side`}
            onChange={(event) => onSideKm(Number(event.target.value))}
          />
          <p className="field-note">{area.toFixed(2)} km² · square frame, max about 2 km²</p>
        </div>

        <div className="field">
          <p className="kicker">Include in the model</p>
          <ul className="layers">
            {ROWS.map((row) => (
              <li key={row.key}>
                <span className="layer-name">
                  {row.label}
                  {row.soon && <span className="soon">Soon</span>}
                  {row.hint && <span className="layer-hint">{row.hint}</span>}
                </span>
                <button
                  type="button"
                  className={layers[row.key] ? "toggle on" : "toggle"}
                  aria-pressed={layers[row.key]}
                  aria-label={row.label}
                  onClick={() => onLayer(row.key, !layers[row.key])}
                >
                  <i />
                </button>
              </li>
            ))}
          </ul>
          {soonOn.length > 0 && (
            <p className="field-note">
              {soonOn
                .map((key) => ROWS.find((row) => row.key === key)?.label)
                .filter(Boolean)
                .join(", ")}{" "}
              {soonOn.length === 1 ? "is" : "are"} not exported in this version.
            </p>
          )}
        </div>
      </div>

      <div className="sidebar-foot">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="button" disabled={loading} onClick={onCreate}>
          {loading ? "Reading the map…" : "Create model"}
        </button>
        <p className="hint">Pan and zoom until the block you want sits inside the frame.</p>
        <p className="attrib">© OpenStreetMap contributors</p>
      </div>
    </aside>
  );
}
