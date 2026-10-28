"use client";

import { useState } from "react";
import type { Taste } from "@/shared/api";
import styles from "./TasteChips.module.css";

type Props = { taste: Taste | null; onChange: (taste: Taste) => void };

export function TasteChips({ taste, onChange }: Props) {
  const [off, setOff] = useState<Set<string>>(new Set());

  if (!taste) return <p className="note-blue">No saved taste yet</p>;

  const chips = [
    ...taste.brands.map((v) => ({ id: `b:${v}`, label: v })),
    ...taste.avoid.map((v) => ({ id: `a:${v}`, label: `avoid ${v}` })),
    ...Object.entries(taste.attributes).map(([k, v]) => ({ id: `t:${k}`, label: `${k}: ${v}` })),
  ];

  const toggle = (id: string) => {
    const next = new Set(off);
    if (!next.delete(id)) next.add(id);
    setOff(next);
    onChange({
      brands: taste.brands.filter((v) => !next.has(`b:${v}`)),
      avoid: taste.avoid.filter((v) => !next.has(`a:${v}`)),
      attributes: Object.fromEntries(
        Object.entries(taste.attributes).filter(([k]) => !next.has(`t:${k}`)),
      ),
    });
  };

  return (
    <div className={styles.wrap}>
      <span className="note-blue">Still right?</span>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className={chipClass(off, c.id)}
          aria-pressed={!off.has(c.id)}
          onClick={() => toggle(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function chipClass(off: Set<string>, id: string) {
  return off.has(id) ? "chip chip-off" : "chip";
}
