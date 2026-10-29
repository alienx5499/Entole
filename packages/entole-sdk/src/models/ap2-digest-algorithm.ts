import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The hash behind `digest`, always `sha-256`. */
export const Ap2DigestAlgorithm = {
  /** SHA-256, hex encoded. */
  Sha256: "sha-256",
} as const;
export type Ap2DigestAlgorithm = (typeof Ap2DigestAlgorithm)[keyof typeof Ap2DigestAlgorithm] | (string & {});

export const ap2DigestAlgorithmSchema: EnumSchema<Ap2DigestAlgorithm> =
  s.enumOf<Ap2DigestAlgorithm>(Ap2DigestAlgorithm);
