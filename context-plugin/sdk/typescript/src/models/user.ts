import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** The Entole user who owns the token, from their PayPal sign-in. */
export type User = {
  /** The user id, `user_` followed by a UUID. */
  id: string;
  /** The email address on the user's PayPal account. */
  email: string;
  /** The name on the user's PayPal account. */
  name: string;
};

export const userSchema: Schema<User> = s.object<User>({
  id: s.string(),
  email: s.string(),
  name: s.string(),
});
