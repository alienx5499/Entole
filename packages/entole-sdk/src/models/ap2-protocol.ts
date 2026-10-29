import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The protocol name, always `AP2`. */
export const Ap2Protocol = {
  /** Agent Payments Protocol. */
  Ap2: "AP2",
} as const;
export type Ap2Protocol = (typeof Ap2Protocol)[keyof typeof Ap2Protocol] | (string & {});

export const ap2ProtocolSchema: EnumSchema<Ap2Protocol> = s.enumOf<Ap2Protocol>(Ap2Protocol);
