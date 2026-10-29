import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The AP2 version the export follows, always `0.2`. */
export const Ap2Version = {
  /** AP2 v0.2, the release of 2026-04-28. */
  _02: "0.2",
} as const;
export type Ap2Version = (typeof Ap2Version)[keyof typeof Ap2Version] | (string & {});

export const ap2VersionSchema: EnumSchema<Ap2Version> = s.enumOf<Ap2Version>(Ap2Version);
