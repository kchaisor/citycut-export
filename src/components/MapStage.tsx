import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { MAP_STYLE, SATELLITE_STYLE } from "../content/constants";
import { M_PER_DEG_LAT, formatKmSide, mPerDegLon } from "../lib/geo";
import type { Basemap, ViewState } from "../types";

export type FlyRequest = {
  token: number;
  lon: number;
  lat: number;
  zoom?: number;
  bounds: [number, number, number, number] | null;
};

type Frame = { left: number; top: number; width: number; height: number };

export function MapStage({
  basemap,
  sideM,
  initialView,
  fly,
  loading,
  onCancel,
  onView,
  onBasemap,
}: {
  basemap: Basemap;
  sideM: number;
  initialView: ViewState;
  fly: FlyRequest | null;
  loading: boolean;
  onCancel: () => void;
  onView: (view: ViewState) => void;
  onBasemap: (basemap: Basemap) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const sideRef = useRef(sideM);
  const onViewRef = useRef(onView);
  const appliedBasemap = useRef<Basemap>(basemap);
  const mountedFly = useRef(fly?.token ?? null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [ready, setReady] = useState(false);
  sideRef.current = sideM;
  onViewRef.current = onView;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: basemap === "satellite" ? SATELLITE_STYLE : MAP_STYLE,
      center: [initialView.lon, initialView.lat],
      zoom: initialView.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    const update = () => {
      const center = map.getCenter();
      const half = sideRef.current / 2;
      const dLat = half / M_PER_DEG_LAT;
      const dLon = half / mPerDegLon(center.lat);
      const northWest = map.project([center.lng - dLon, center.lat + dLat]);
      const southEast = map.project([center.lng + dLon, center.lat - dLat]);
      const left = Math.min(northWest.x, southEast.x);
      const top = Math.min(northWest.y, southEast.y);
      setFrame({
        left,
        top,
        width: Math.abs(southEast.x - northWest.x),
        height: Math.abs(southEast.y - northWest.y),
      });
      onViewRef.current({ lon: center.lng, lat: center.lat, zoom: map.getZoom() });
    };

    map.on("load", () => {
      setReady(true);
      update();
    });
    map.on("move", update);
    map.on("resize", update);

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The map is created once per mount. Later camera changes go through flyTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sideRef.current = sideM;
    const map = mapRef.current;
    if (!map || !ready) return;
    map.fire("move");
  }, [sideM, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (appliedBasemap.current === basemap) return;
    appliedBasemap.current = basemap;
    map.setStyle(basemap === "satellite" ? SATELLITE_STYLE : MAP_STYLE);
    map.once("style.load", () => map.fire("move"));
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fly || !ready) return;
    if (fly.token === mountedFly.current) return;
    mountedFly.current = fly.token;
    if (fly.bounds) {
      map.fitBounds(
        [
          [fly.bounds[0], fly.bounds[1]],
          [fly.bounds[2], fly.bounds[3]],
        ],
        { padding: 56, maxZoom: 16, duration: 1100 },
      );
    } else {
      map.flyTo({
        center: [fly.lon, fly.lat],
        zoom: fly.zoom ?? Math.max(map.getZoom(), 15),
        duration: 1100,
      });
    }
  }, [fly, ready]);

  const sideKm = sideM / 1000;
  const label = `${formatKmSide(sideKm)} × ${formatKmSide(sideKm)} km`;

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-canvas" />
      <div className="basemap" role="group" aria-label="Basemap">
        <button
          type="button"
          className={basemap === "map" ? "active" : ""}
          onClick={() => onBasemap("map")}
        >
          Map
        </button>
        <button
          type="button"
          className={basemap === "satellite" ? "active" : ""}
          onClick={() => onBasemap("satellite")}
        >
          Satellite
        </button>
      </div>
      {frame && frame.width > 8 && (
        <>
          <div
            className="frame"
            style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
          />
          <div
            className="frame-label"
            style={{
              left: Math.min(
                Math.max(frame.left + frame.width / 2, 70),
                (containerRef.current?.clientWidth ?? 800) - 70,
              ),
              top: Math.max(frame.top, 12),
            }}
          >
            {label}
          </div>
        </>
      )}
      {loading && <div className="loading-shield" />}
      {loading && (
        <div className="loading-card" role="status">
          <strong>Cutting this block from OpenStreetMap</strong>
          <p>Fetching buildings, roads, and open space. This often takes a few seconds, sometimes longer.</p>
          <div className="bar" aria-hidden="true">
            <span />
          </div>
          <button className="text-btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
