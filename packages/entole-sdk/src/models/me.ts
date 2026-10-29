import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { tasteSchema, type Taste } from "./taste.js";
import { userSchema, type User } from "./user.js";

/** The token's owner and their saved taste. */
export type Me = {
  /** The Entole user who owns the token, from their PayPal sign-in. */
  user: User;
  /**
   * Brands, avoids and attributes saved from the user's funded orders; null until one order was
   * funded.
   */
  taste: Taste | null;
};

export const meSchema: Schema<Me> = s.object<Me>({
  user: userSchema,
  taste: s.nullable(s.lazy(() => tasteSchema)),
});
