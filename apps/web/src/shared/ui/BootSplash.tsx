"use client";

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { getSession } from "@/shared/api";
import styles from "./BootSplash.module.css";

// Never hold the page longer than this, even if an image or the API hangs.
const MAX_WAIT_MS = 5000;
const FADE_MS = 300;
// The intro's full length (settle runs 1.2 s) plus a beat on the finished logo; every load
// plays it to the end.
const INTRO_MS = 1650;
// Start the intro once the logo layers are decoded, or after this if one is slow.
const DECODE_WAIT_MS = 1500;
const LAYERS = ["dome", "sig", "dash"].map((l) => `/img/splash-${l}.webp`);

const pageLoaded = () =>
  new Promise<void>((resolve) => {
    if (document.readyState === "complete") resolve();
    else window.addEventListener("load", () => resolve(), { once: true });
  });

// Two frames: the first lets React commit the session state, the second lets the browser paint it.
const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// All logo layers decoded, so the intro never starts with a layer missing.
const layersDecoded = (el: HTMLElement | null) =>
  Promise.race([
    Promise.all(
      Array.from(el?.querySelectorAll("img") ?? []).map((img) =>
        img.decode().catch(() => undefined),
      ),
    ),
    sleep(DECODE_WAIT_MS),
  ]);

// Resolves once the page has no full-page loader left (its first data is in), checked each frame.
const pageLoadersGone = () =>
  new Promise<void>((resolve) => {
    const check = () =>
      document.querySelector("[data-page-loader]") ? requestAnimationFrame(check) : resolve();
    check();
  });

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Plays the full logo intro on every full page load and lifts when both the intro and the page
 * (fonts, above-the-fold images, the login check) are done. Client navigations keep the layout
 * mounted, so this only runs on a full load.
 */
export function BootSplash() {
  const [phase, setPhase] = useState<"shown" | "fading" | "gone">("shown");
  const [playing, setPlaying] = useState(false);
  // Bumped to replay the intro from its first frame while the page is still loading.
  const [cycle, setCycle] = useState(0);
  const logo = useRef<HTMLDivElement>(null);
  // Hoisted into <head>, so the layers are in hand before the splash markup at the end of <body>.
  for (const href of LAYERS) preload(href, { as: "image", fetchPriority: "high" });

  useEffect(() => {
    let cancelled = false;
    const ready = Promise.all([
      document.fonts.ready,
      pageLoaded(),
      getSession().catch(() => undefined),
    ])
      .then(pageLoadersGone)
      .then(nextPaint);
    let pageReady = false;
    let timedOut = false;
    ready.then(() => {
      pageReady = true;
    });
    const cap = setTimeout(() => {
      timedOut = true;
    }, MAX_WAIT_MS);
    // Play the whole intro, again and again while the page loads, and lift only at the end of a
    // full cycle: data that arrives mid-animation never cuts it short. With reduced motion there is
    // no animation, so it simply waits for the page (or the cap).
    (async () => {
      await layersDecoded(logo.current);
      if (cancelled) return;
      setPlaying(true);
      if (reducedMotion()) {
        await Promise.race([ready, sleep(MAX_WAIT_MS)]);
      } else {
        for (;;) {
          await sleep(INTRO_MS);
          if (cancelled || pageReady || timedOut) break;
          setCycle((c) => c + 1);
        }
      }
      if (cancelled) return;
      setPhase("fading");
      await sleep(FADE_MS);
      if (!cancelled) setPhase("gone");
    })();
    return () => {
      cancelled = true;
      clearTimeout(cap);
    };
  }, []);

  if (phase === "gone") return null;
  return (
    <>
      {/* Without scripts the splash could never lift, so it is hidden outright. */}
      <noscript>
        <style>{`.${styles.splash}{display:none}`}</style>
      </noscript>
      <div
        role="status"
        className={phase === "fading" ? `${styles.splash} ${styles.fading}` : styles.splash}
      >
        {/* The video opener's sunrise: the dash draws out, the dome rises, the signature writes on. */}
        <div
          key={cycle}
          ref={logo}
          className={playing ? `${styles.logo} ${styles.play}` : styles.logo}
        >
          <div className={styles.domebox}>
            {/* biome-ignore lint/performance/noImgElement: tiny static logo layers, animated by CSS */}
            <img className={styles.dome} src="/img/splash-dome.webp" alt="" />
          </div>
          {/* biome-ignore lint/performance/noImgElement: tiny static logo layers */}
          <img className={styles.sig} src="/img/splash-sig.webp" alt="" />
          {/* biome-ignore lint/performance/noImgElement: tiny static logo layers */}
          <img className={styles.dash} src="/img/splash-dash.webp" alt="Entole" />
        </div>
      </div>
    </>
  );
}
