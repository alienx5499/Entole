import {
  type Candidate,
  createMandate,
  DAY_MS,
  MAX_CANDIDATES,
  type MandateDeps,
  type MandateTerms,
  type RejectedCandidate,
} from "@entole/mandate";
import type { Money } from "@entole/shared-kernel";
import { type ShortlistDeps, shortlistCandidates } from "@entole/shopping";

export type CreateLimitOrderDeps = MandateDeps &
  ShortlistDeps & {
    // Orders created in the last day, counted by repo.countCreatedSince so a restart keeps them.
    createCaps: { perUser: number; total: number };
    publicBaseUrl: string;
    shippingCallback: boolean;
  };

export type CreateLimitOrderInput = {
  ownerId: string;
  query: string;
  requiredAttributes: Record<string, string>;
  brands: string[];
  avoid: string[];
  limit: Money;
  validDays: number;
  demoInjection: boolean;
  replay: boolean;
};

export type CreateLimitOrderResult =
  | {
      outcome: "created";
      id: string;
      approveUrl: string;
      candidates: Candidate[];
      rejected: RejectedCandidate[];
    }
  | { outcome: "daily_limit_reached" | "service_daily_limit_reached" }
  | { outcome: "no_candidates"; rejected: RejectedCandidate[] };

// Shortlists the products, signs the terms and opens the PayPal hold for the limit. Each create
// spends Groq, Channel3 and PayPal calls, so the day is capped per user and overall first.
export const createLimitOrder = async (
  deps: CreateLimitOrderDeps,
  i: CreateLimitOrderInput,
): Promise<CreateLimitOrderResult> => {
  const now = deps.clock.now();
  const since = new Date(now.getTime() - DAY_MS);
  if ((await deps.repo.countCreatedSince(since, i.ownerId)) >= deps.createCaps.perUser)
    return { outcome: "daily_limit_reached" };
  if ((await deps.repo.countCreatedSince(since)) >= deps.createCaps.total)
    return { outcome: "service_daily_limit_reached" };
  const terms: Omit<MandateTerms, "candidates"> = {
    kind: "limit",
    item: {
      query: i.query,
      requiredAttributes: i.requiredAttributes,
      brands: i.brands,
      avoid: i.avoid,
    },
    maxUnitPrice: i.limit,
    budget: i.limit,
    allowedMerchants: [], // empty means any merchant; the signed candidates pin the items
    validUntil: new Date(now.getTime() + i.validDays * DAY_MS),
  };
  const shortlist = await shortlistCandidates(deps, {
    terms,
    demoInjection: i.demoInjection,
    max: MAX_CANDIDATES,
  });
  if (shortlist.kept.length === 0)
    return { outcome: "no_candidates", rejected: shortlist.rejected };
  const { mandate, approveUrl } = await createMandate(deps, {
    ownerId: i.ownerId,
    terms: { ...terms, candidates: shortlist.kept },
    demoInjection: i.demoInjection,
    replay: i.replay,
    rejected: shortlist.rejected,
    baseUrl: deps.publicBaseUrl,
    shippingCallback: deps.shippingCallback,
  });
  return {
    outcome: "created",
    id: mandate.id,
    approveUrl,
    candidates: shortlist.kept,
    rejected: shortlist.rejected,
  };
};
