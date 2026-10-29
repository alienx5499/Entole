import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The AP2 mode, always `human_not_present`. */
export const Ap2Mode = {
  /**
   * The buyer approves open mandates up front, then the agent closes them on one checkout without
   * the buyer present.
   */
  HumanNotPresent: "human_not_present",
} as const;
export type Ap2Mode = (typeof Ap2Mode)[keyof typeof Ap2Mode] | (string & {});

export const ap2ModeSchema: EnumSchema<Ap2Mode> = s.enumOf<Ap2Mode>(Ap2Mode);
