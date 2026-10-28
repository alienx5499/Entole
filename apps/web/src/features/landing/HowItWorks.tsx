import { ImageSlot } from "@/shared/ui";
import s from "./landing.module.css";

const STEPS = [
  {
    title: "Log in",
    body: "Log in with PayPal. Brands, words to avoid and the size from your last order show up as chips you can keep or remove.",
  },
  {
    title: "Set your price",
    body: "Write what you want and the most you will pay, for example running shoes, size 10, no white, $170 or less, within 3 days.",
  },
  {
    title: "The agent shortlists",
    body: "An agent on Groq picks up to 3 products from Channel3 that fit your rules. Rejected products are listed with the reason.",
  },
  {
    title: "Sign the hold",
    body: "You approve one PayPal hold for your limit. The approval signs your terms and the shortlist.",
  },
  {
    title: "The price drops",
    body: "A watcher checks Channel3 prices. When one reaches your limit, plain code checks the offer against what you signed.",
  },
  {
    title: "Pay and release",
    body: "PayPal captures that one item from the hold and the rest of the hold is released. If nothing hits your price in time, the whole hold is released.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className={s.section} aria-labelledby="how-title">
      <h2 id="how-title">How it works</h2>
      <div className={s.howMedia}>
        <ImageSlot
          className={s.slotImage}
          src="/img/how-it-works.webp"
          alt="The six steps from setting a price to PayPal capturing one item and releasing the rest"
          width={2172}
          height={724}
          fallback={null}
        />
      </div>
      <ol className={s.steps}>
        {STEPS.map((step, i) => (
          <li key={step.title} className={s.step}>
            <span className={s.stepNum} aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
