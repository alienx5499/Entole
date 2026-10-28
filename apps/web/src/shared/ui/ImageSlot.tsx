"use client";

import Image from "next/image";
import { type ReactNode, useState } from "react";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  fallback: ReactNode;
  priority?: boolean;
  className?: string;
  /** Rendered width hint for srcset; defaults to the 1120px page column. */
  sizes?: string;
};

/** Shows an optional image from public/, or the fallback when the file is not there yet. */
export function ImageSlot({
  src,
  alt,
  width,
  height,
  fallback,
  priority = false,
  className,
  sizes = "(max-width: 1120px) 100vw, 1120px",
}: Props) {
  const [missing, setMissing] = useState(false);
  if (missing) return fallback;
  return (
    <Image
      className={className}
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      sizes={sizes}
      quality={90}
      onError={() => setMissing(true)}
    />
  );
}
