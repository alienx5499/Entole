import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { ap2ConfirmationSchema, type Ap2Confirmation } from "./ap2-confirmation.js";
import { ap2ConstraintSchema, type Ap2Constraint } from "./ap2-constraint.js";
import { ap2OpenMandateTypeSchema, type Ap2OpenMandateType } from "./ap2-open-mandate-type.js";

/**
 * An AP2 open mandate (`mandate.checkout.open.1` or `mandate.payment.open.1`). The constraint
 * objects follow the AP2 JSON schemas and are left open here.
 */
export type Ap2OpenMandate = {
  /** The open mandate's type. */
  vct: Ap2OpenMandateType;
  /** The limits the buyer approved, which the closed mandates must meet. */
  constraints: Ap2Constraint[];
  /** The AP2 `cnf` claim. Always `{}`: Entole holds no agent key, so `kid` is never set. */
  cnf: Ap2Confirmation;
  /** When the order was created, in Unix seconds. */
  iat: number;
  /** When the order's window ends, in Unix seconds. */
  exp: number;
};

export const ap2OpenMandateSchema: Schema<Ap2OpenMandate> = s.object<Ap2OpenMandate>({
  vct: ap2OpenMandateTypeSchema,
  constraints: s.array(s.lazy(() => ap2ConstraintSchema)),
  cnf: ap2ConfirmationSchema,
  iat: s.int(),
  exp: s.int(),
});
