"use client";

import { useEffect, useRef } from "react";
import styles from "./CurveLoader.module.css";

// Math curves drawn as a comet of particles; idea after paidax01/math-curve-loaders.
const PARTICLES = 70;
const TRAIL = 0.4;
const LAP_MS = 5600;
const PULSE_MS = 5000;
const A = 36;
const BOOST = 8;
const HEAD_SHARE = 0.15;
const COBALT = "#1f3fbf";
const NAVY = "#1b1f3a";
const YELLOW = "#f5d547";

const pulseAt = (time: number) =>
  0.52 + ((Math.sin(((time % PULSE_MS) / PULSE_MS) * Math.PI * 2) + 1) / 2) * 0.48;

type Point = { x: number; y: number };
type Shape = {
  point: (progress: number, pulse: number) => Point;
  // Two stroke halves, coloured left and right.
  halves: readonly { from: number; to: number }[];
  viewBox: string;
};

// Bernoulli lemniscate. Left lobe is cos t < 0 (progress 0.25..0.75), right lobe is the rest.
// The curve only fills the middle band of the 100x100 canvas, so the viewBox crops to it.
const LEMNISCATE: Shape = {
  point(progress, pulse) {
    const t = progress * Math.PI * 2;
    const scale = A + pulse * BOOST;
    const d = 1 + Math.sin(t) ** 2;
    return { x: 50 + (scale * Math.cos(t)) / d, y: 50 + (scale * Math.sin(t) * Math.cos(t)) / d };
  },
  halves: [
    { from: 0.25, to: 0.75 },
    { from: 0.75, to: 1.25 },
  ],
  viewBox: "2 30 96 40",
};

// Three-petal rose, r = cos(3t); one pass over t in [0, pi] draws all three petals.
const ROSE: Shape = {
  point(progress, pulse) {
    const t = progress * Math.PI;
    const r = (34 + pulse * BOOST) * Math.cos(3 * t);
    return { x: 50 + r * Math.cos(t), y: 50 + r * Math.sin(t) };
  },
  halves: [
    { from: 0, to: 0.5 },
    { from: 0.5, to: 1 },
  ],
  viewBox: "6 6 88 88",
};

const SHAPES = { lemniscate: LEMNISCATE, rose: ROSE } as const;
type ShapeName = keyof typeof SHAPES;

function curvePath(shape: Shape, pulse: number, from: number, to: number, steps = 90) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const p = shape.point(from + ((to - from) * i) / steps, pulse);
    d += `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return d;
}

type Colors = { left: string; right: string; head: string };

// One dot at time `time`; the same maths draws the server frame and every animation frame.
function dotAt(shape: Shape, i: number, time: number, colors: Colors) {
  const lap = (time % LAP_MS) / LAP_MS;
  const pulse = pulseAt(time);
  const tail = i / (PARTICLES - 1);
  const p = shape.point((((lap - tail * TRAIL) % 1) + 1) % 1, pulse);
  const fade = (1 - tail) ** 0.56;
  return {
    fill: tail < HEAD_SHARE ? colors.head : p.x < 50 ? colors.left : colors.right,
    cx: p.x.toFixed(2),
    cy: p.y.toFixed(2),
    r: (0.9 + fade * 2.6).toFixed(2),
    opacity: (0.04 + fade * 0.96).toFixed(3),
  };
}

// "ink" for paper backgrounds, "paper" for dark backgrounds such as a primary button.
const PALETTES = {
  ink: { left: COBALT, right: NAVY, head: YELLOW },
  paper: { left: "#f7f2e7", right: "#cfd6ff", head: YELLOW },
} as const;
type Palette = keyof typeof PALETTES;

function Curve({
  palette = "ink",
  className = styles.svg,
  shape: name = "rose",
}: {
  palette?: Palette;
  className?: string;
  shape?: ShapeName;
}) {
  const colors = PALETTES[palette];
  const shape = SHAPES[name];
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const dots = useRef<(SVGCircleElement | null)[]>([]);

  useEffect(() => {
    const drawCurve = (pulse: number) =>
      shape.halves.forEach((h, i) => {
        paths.current[i]?.setAttribute("d", curvePath(shape, pulse, h.from, h.to));
      });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drawCurve(0.76);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const render = (now: number) => {
      const time = now - start;
      drawCurve(pulseAt(time));
      dots.current.forEach((dot, i) => {
        if (!dot) return;
        for (const [k, v] of Object.entries(dotAt(shape, i, time, colors))) dot.setAttribute(k, v);
      });
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [colors, shape]);

  return (
    <svg viewBox={shape.viewBox} fill="none" aria-hidden="true" className={className}>
      {shape.halves.map((h, i) => (
        <path
          key={h.from}
          ref={(el) => {
            paths.current[i] = el;
          }}
          d={curvePath(shape, pulseAt(0), h.from, h.to)}
          stroke={i === 0 ? colors.left : colors.right}
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.18}
        />
      ))}
      {Array.from({ length: PARTICLES }, (_, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length list, never reordered
          key={i}
          ref={(el) => {
            dots.current[i] = el;
          }}
          {...dotAt(shape, i, 0, colors)}
        />
      ))}
    </svg>
  );
}

type Props = {
  size?: "screen" | "inline";
  title?: string;
  subtitle?: string;
  shape?: ShapeName;
  className?: string;
};

export function CurveLoader({
  size = "screen",
  title = "Loading",
  subtitle,
  shape = "rose",
  className,
}: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      // The boot splash waits until no full-page loader is left, so a reload shows one animation.
      data-page-loader={size === "screen" ? "" : undefined}
      className={className ? `${styles[size]} ${className}` : styles[size]}
    >
      <Curve
        shape={shape}
        className={shape === "rose" ? `${styles.svg} ${styles.rose}` : styles.svg}
      />
      <div>
        <p className={styles.title}>{title}</p>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
    </div>
  );
}

/** Small decorative loader for inside a button; the button text carries the meaning. */
export function CurveSpinner({ palette = "paper" }: { palette?: Palette }) {
  return <Curve palette={palette} shape="rose" className={`${styles.spinner} ${styles.rose}`} />;
}
