import { useEffect, useMemo, useRef, useState } from "react";
import { planPaths } from "../lib/svgPlan";
import type { CityModel } from "../types";

type View = { x: number; y: number; w: number; h: number };

export function DrawingPlan({ model }: { model: CityModel }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; view: View } | null>(null);
  const paths = useMemo(() => planPaths(model), [model]);
  const fitted = useMemo<View>(() => {
    const pad = model.sideM * 0.045;
    const size = model.sideM + pad * 2;
    return { x: -model.sideM / 2 - pad, y: -model.sideM / 2 - pad, w: size, h: size };
  }, [model]);
  const [view, setView] = useState<View>(fitted);

  useEffect(() => {
    setView(fitted);
  }, [fitted]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const factor = Math.exp(pixels * 0.0012);
      setView((current) => {
        const w = current.w * factor;
        const h = current.h * factor;
        if (w < model.sideM * 0.04 || w > model.sideM * 6) return current;
        return {
          x: current.x + (current.w - w) * px,
          y: current.y + (current.h - h) * py,
          w,
          h,
        };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [model.sideM]);

  const half = model.sideM / 2;
  const empty =
    model.buildings.length === 0 &&
    model.roads.length === 0 &&
    model.areas.length === 0 &&
    model.trees.length === 0;

  return (
    <svg
      ref={svgRef}
      className="plan"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      role="img"
      aria-label="Vector site plan"
      onDoubleClick={() => setView(fitted)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { px: event.clientX, py: event.clientY, view };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        const svg = svgRef.current;
        if (!start || !svg) return;
        const rect = svg.getBoundingClientRect();
        const dx = ((event.clientX - start.px) / rect.width) * start.view.w;
        const dy = ((event.clientY - start.py) / rect.height) * start.view.h;
        setView({ ...start.view, x: start.view.x - dx, y: start.view.y - dy });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="#e7e2d8" />
      <rect x={-half} y={-half} width={model.sideM} height={model.sideM} fill="#f4f1ea" />
      {paths.green.map((d, index) => (
        <path key={`g${index}`} d={d} fill="#b7d39a" />
      ))}
      {paths.water.map((d, index) => (
        <path key={`w${index}`} d={d} fill="#9ec9d1" />
      ))}
      {paths.roads.map((road, index) => (
        <path
          key={`r${index}`}
          d={road.d}
          fill="none"
          stroke="#c3b6a4"
          strokeWidth={road.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {paths.rails.map((rail, index) => (
        <path
          key={`l${index}`}
          d={rail.d}
          fill="none"
          stroke="#8d6244"
          strokeWidth={rail.width}
          strokeDasharray={`${rail.width * 1.6} ${rail.width}`}
          strokeLinecap="butt"
        />
      ))}
      {paths.buildings.map((d, index) => (
        <path key={`b${index}`} d={d} fill="#1c1b17" fillRule="evenodd" />
      ))}
      {paths.trees.map((tree, index) => (
        <circle
          key={`t${index}`}
          cx={tree.x}
          cy={tree.y}
          r={tree.r}
          fill="#6ea35a"
          stroke="#245232"
          strokeWidth={Math.max(model.sideM * 0.0015, 0.4)}
        />
      ))}
      <rect
        x={-half}
        y={-half}
        width={model.sideM}
        height={model.sideM}
        fill="none"
        stroke="#1c1b17"
        strokeWidth={model.sideM * 0.004}
      />
      <text
        x={0}
        y={-half + model.sideM * 0.04}
        textAnchor="middle"
        fontSize={model.sideM * 0.03}
        fill="#1c1b17"
      >
        N
      </text>
      {empty && (
        <text x={0} y={0} textAnchor="middle" fontSize={model.sideM * 0.04} fill="#6d675e">
          Nothing mapped in this frame
        </text>
      )}
    </svg>
  );
}
