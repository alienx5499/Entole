"use client";

import { useState } from "react";
import s from "./connect-ai.module.css";

/** Monospace text with a copy button; on a browser without clipboard access the text is selected. */
export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [pre, setPre] = useState<HTMLPreElement | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (pre) window.getSelection()?.selectAllChildren(pre);
    }
  }

  return (
    <div className={s.copy}>
      <pre ref={setPre} className={s.code}>
        {text}
      </pre>
      <button type="button" className="btn btn-secondary" onClick={copy}>
        {copied ? "Copied" : `Copy ${label}`}
      </button>
      <span className={s.sr} aria-live="polite">
        {copied ? `${label} copied` : ""}
      </span>
    </div>
  );
}
