import s from "./landing.module.css";

export function TryIt() {
  return (
    <section className={s.section} aria-labelledby="try-title">
      <h2 id="try-title">Try it in 2 minutes</h2>
      <ol className={s.tryList}>
        <li>Log in with a PayPal sandbox buyer account.</li>
        <li>
          Keep both demo boxes ticked: <em>Add a malicious listing</em> and{" "}
          <em>Replay real price history</em>. Write a limit order and sign the hold.
        </li>
        <li>
          Press <strong>Simulate compromised agent</strong>. The check blocks the planted listing.
        </li>
        <li>
          Press <strong>Start replay</strong>. Real Channel3 price history plays in about a minute,
          and PayPal captures one item when a price reaches your limit.
        </li>
      </ol>
      <p className={s.sandbox}>PayPal sandbox, no real money.</p>
    </section>
  );
}
