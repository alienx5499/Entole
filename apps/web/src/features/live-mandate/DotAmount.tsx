"use client";

import { useEffect, useState } from "react";
import s from "./DotAmount.module.css";

type Props = { amount: string; label?: string };

const DURATION_MS = 900;
const PITCH = 7;
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  ".": ["0", "0", "0", "0", "0", "0", "1"],
  ",": ["00", "00", "00", "00", "00", "01", "10"],
};

/** Parses "$1,234.50" into whole cents; null when no digits are present. */
function toCents(amount: string): number | null {
  const [whole = "", frac = ""] = amount.replace(/[^\d.]/g, "").split(".");
  if (!whole && !frac) return null;
  return Number(whole || "0") * 100 + Number(`${frac}00`.slice(0, 2));
}

function format(cents: number, like: string): string {
  const prefix = like.match(/^[^\d]*/)?.[0] ?? "";
  const whole = Math.floor(cents / 100);
  const w = like.includes(",") ? whole.toLocaleString("en-US") : String(whole);
  return `${prefix}${w}.${String(cents % 100).padStart(2, "0")}`;
}

function useCountUp(target: number | null): number | null {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (target === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

export function DotAmount({ amount, label }: Props) {
  const target = toCents(amount);
  const cents = useCountUp(target);
  // Settled value is the exact API string; intermediate frames are formatted.
  const text = cents === null || cents === target ? amount : format(cents, amount);
  const glyphs = [...text].map((ch) => GLYPHS[ch]).filter((g): g is string[] => Boolean(g));
  let x = 0;
  const dots: { key: string; cx: number; cy: number; on: boolean }[] = [];
  glyphs.forEach((g, gi) => {
    const w = g[0]?.length ?? 0;
    g.forEach((row, y) => {
      [...row].forEach((bit, col) => {
        dots.push({ key: `${gi}-${y}-${col}`, cx: x + col, cy: y, on: bit === "1" });
      });
    });
    x += w + 1;
  });
  const width = Math.max(0, x - 1);
  if (dots.length === 0) return <span className="mono">{amount || "$0.00"}</span>;

  return (
    <svg
      className={s.dots}
      viewBox={`-0.6 -0.6 ${width + 1.2} ${PITCH + 0.2}`}
      style={{ aspectRatio: `${width + 1.2} / ${PITCH + 0.2}` }}
      role="img"
      aria-label={label ?? amount}
    >
      {dots.map((d) => (
        <circle key={d.key} cx={d.cx} cy={d.cy} r={0.42} className={d.on ? s.on : s.off} />
      ))}
    </svg>
  );
}
