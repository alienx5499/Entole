import type { Mandate } from "@entole/mandate";
import { type Taste, tasteFrom } from "../domain/taste.ts";
import type { TasteRepository } from "./ports.ts";

export const getTaste = (
  deps: { tastes: TasteRepository },
  userId: string,
): Promise<Taste | null> => deps.tastes.get(userId);

// Call only after funding succeeded: an unapproved mandate leaves no taste behind.
export const rememberTaste = (deps: { tastes: TasteRepository }, funded: Mandate): Promise<void> =>
  deps.tastes.save(funded.ownerId, tasteFrom(funded.terms.item));
