import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { SATELLITE_STYLE } from "../content/constants";
import { squareBBox } from "../lib/geo";
import type { CityModel } from "../types";

export function SatellitePane({ model }: { model: CityModel }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const bounds = squareBBox(model.center, model.sideM);
    const map = new maplibregl.Map({
      container,
      style: SATELLITE_STYLE,
      center: [model.center.lon, model.center.lat],
      zoom: 15,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const ring: [number, number][] = [
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
      [bounds.east, bounds.north],
      [bounds.west, bounds.north],
      [bounds.west, bounds.south],
    ];
    map.on("load", () => {
      map.addSource("cut", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } },
      });
      map.addLayer({
        id: "cut-line",
        type: "line",
        source: "cut",
        paint: { "line-color": "#f7f4ee", "line-width": 2 },
      });
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        { padding: 28, duration: 0, animate: false },
      );
    });
    return () => map.remove();
  }, [model]);

  return <div ref={ref} className="map-canvas" />;
}
