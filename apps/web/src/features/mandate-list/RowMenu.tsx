"use client";

import { useCallback, useRef, useState } from "react";
import { useDismiss } from "@/shared/ui";
import s from "./mandate-list.module.css";

type Props = { label: string; busy: boolean; onCancel: () => void };

/** The "⋯" menu on an unapproved order; cancelling lives here so it is never one stray click. */
export function RowMenu({ label, busy, onCancel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div className={s.more} ref={ref}>
      <button
        type="button"
        className={s.moreButton}
        aria-label={`More for ${label}`}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? "…" : "⋯"}
      </button>
      {open && (
        <div className={s.moreMenu}>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCancel();
            }}
          >
            Cancel order
          </button>
        </div>
      )}
    </div>
  );
}
