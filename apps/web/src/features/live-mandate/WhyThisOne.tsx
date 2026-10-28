import type { MandateView } from "@/shared/api";

type Purchase = NonNullable<MandateView["purchase"]>;

export function WhyThisOne({ purchase }: { purchase: Purchase }) {
  return (
    <section className="card">
      <h3>Why this one</h3>
      <p>
        Picked: {purchase.title} at <span className="mono">${purchase.price}</span> from{" "}
        {purchase.merchant}
        {purchase.shopsCompared > 1 && `, the cheapest of ${purchase.shopsCompared} shops`}
      </p>
      {purchase.whyThisOne.skipped.length > 0 && (
        <>
          <p>Skipped:</p>
          <ul>
            {purchase.whyThisOne.skipped.map((k) => (
              <li key={k.title}>
                {k.title}
                <ul>
                  {k.reasons.map((r) => (
                    <li key={r} className="pen-strike">
                      {r}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
