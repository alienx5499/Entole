import type { MandateView } from "@/shared/api";
import { DotAmount } from "./DotAmount";
import s from "./SavingsBadge.module.css";

type Purchase = NonNullable<MandateView["purchase"]>;

export function SavingsBadge({ purchase }: { purchase: Purchase }) {
  const saved = Number(purchase.savings) > 0;
  const where = purchase.inReplay ? " in replay" : "";
  return (
    <p className={`highlight ${s.badge}`}>
      {saved ? (
        <>
          <DotAmount amount={`$${purchase.savings}`} label={`Saved $${purchase.savings}`} /> saved
          {where} (sandbox)
        </>
      ) : (
        <>Bought at today's price{where} (sandbox)</>
      )}
    </p>
  );
}
