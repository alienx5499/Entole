import Link from "next/link";
import type { ReactNode } from "react";
import s from "./ScribbleLink.module.css";

type Props = { href: string; children: ReactNode; className?: string };

// A loose pen stroke under the text that draws itself on hover and focus.
function Scribble() {
  return (
    <svg className={s.line} viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
      <path pathLength={1} d="M1 7 C 14 3, 26 10, 40 6 S 66 3, 79 7 S 94 9, 99 4" />
      <path pathLength={1} d="M4 10 C 30 8, 62 11, 97 8" />
    </svg>
  );
}

/** Text link with a hand-drawn underline. External URLs open in a new tab. */
export function ScribbleLink({ href, children, className = "" }: Props) {
  const external = /^https?:\/\//.test(href);
  const cls = `${s.link} ${className}`.trim();
  const body = (
    <>
      <span>{children}</span>
      <Scribble />
    </>
  );
  if (external)
    return (
      <a className={cls} href={href} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  return (
    <Link className={cls} href={href}>
      {body}
    </Link>
  );
}
