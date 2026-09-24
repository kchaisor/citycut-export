import type { Pt } from "../types";

const INSIDE = 0;
const LEFT = 1;
const RIGHT = 2;
const BOTTOM = 4;
const TOP = 8;

function outCode(x: number, y: number, min: number, max: number): number {
  let code = INSIDE;
  if (x < min) code |= LEFT;
  else if (x > max) code |= RIGHT;
  if (y < min) code |= BOTTOM;
  else if (y > max) code |= TOP;
  return code;
}

/** Cohen–Sutherland clip of one segment against an axis-aligned square. */
export function clipSegment(a: Pt, b: Pt, min: number, max: number): [Pt, Pt] | null {
  let x0 = a[0];
  let y0 = a[1];
  let x1 = b[0];
  let y1 = b[1];
  let c0 = outCode(x0, y0, min, max);
  let c1 = outCode(x1, y1, min, max);

  for (let i = 0; i < 16; i++) {
    if ((c0 | c1) === 0) return [[x0, y0], [x1, y1]];
    if (c0 & c1) return null;
    const code = c0 || c1;
    let x = 0;
    let y = 0;
    if (code & TOP) {
      x = x0 + ((x1 - x0) * (max - y0)) / (y1 - y0);
      y = max;
    } else if (code & BOTTOM) {
      x = x0 + ((x1 - x0) * (min - y0)) / (y1 - y0);
      y = min;
    } else if (code & RIGHT) {
      y = y0 + ((y1 - y0) * (max - x0)) / (x1 - x0);
      x = max;
    } else {
      y = y0 + ((y1 - y0) * (min - x0)) / (x1 - x0);
      x = min;
    }
    if (code === c0) {
      x0 = x;
      y0 = y;
      c0 = outCode(x0, y0, min, max);
    } else {
      x1 = x;
      y1 = y;
      c1 = outCode(x1, y1, min, max);
    }
  }
  return null;
}

export function clipPolyline(points: Pt[], min: number, max: number): Pt[][] {
  const parts: Pt[][] = [];
  let current: Pt[] = [];

  const flush = () => {
    if (current.length >= 2) parts.push(current);
    current = [];
  };

  const same = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01;

  for (let i = 0; i < points.length - 1; i++) {
    const segment = clipSegment(points[i], points[i + 1], min, max);
    if (!segment) {
      flush();
      continue;
    }
    if (current.length === 0) current.push(segment[0]);
    else if (!same(current[current.length - 1], segment[0])) {
      flush();
      current.push(segment[0]);
    }
    if (!same(current[current.length - 1], segment[1])) current.push(segment[1]);
  }
  flush();
  return parts;
}

function hitX(a: Pt, b: Pt, x: number): Pt {
  const dx = b[0] - a[0];
  if (Math.abs(dx) < 1e-12) return [x, a[1]];
  const t = (x - a[0]) / dx;
  return [x, a[1] + (b[1] - a[1]) * t];
}

function hitY(a: Pt, b: Pt, y: number): Pt {
  const dy = b[1] - a[1];
  if (Math.abs(dy) < 1e-12) return [a[0], y];
  const t = (y - a[1]) / dy;
  return [a[0] + (b[0] - a[0]) * t, y];
}

function clipHalf(
  input: Pt[],
  inside: (point: Pt) => boolean,
  intersect: (a: Pt, b: Pt) => Pt,
): Pt[] {
  if (input.length === 0) return [];
  const output: Pt[] = [];
  let previous = input[input.length - 1];
  let previousInside = inside(previous);
  for (const current of input) {
    const currentInside = inside(current);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersect(previous, current));
    }
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

/** Sutherland–Hodgman clip against the cut square. */
export function clipPolygon(ring: Pt[], min: number, max: number): Pt[] {
  let output = ring.slice();
  if (output.length >= 2) {
    const a = output[0];
    const b = output[output.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) output = output.slice(0, -1);
  }
  const slack = 1e-6;
  output = clipHalf(output, (p) => p[0] >= min - slack, (a, b) => hitX(a, b, min));
  output = clipHalf(output, (p) => p[0] <= max + slack, (a, b) => hitX(a, b, max));
  output = clipHalf(output, (p) => p[1] >= min - slack, (a, b) => hitY(a, b, min));
  output = clipHalf(output, (p) => p[1] <= max + slack, (a, b) => hitY(a, b, max));
  return output;
}
