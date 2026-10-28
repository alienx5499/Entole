import { ImageSlot } from "@/shared/ui";
import s from "./landing.module.css";

const POINTS = [
  {
    title: "Your approval is the signature",
    body: "Your terms and the shortlist are hashed into a digest that goes into the PayPal order's custom_id. Approving the hold signs those exact terms.",
  },
  {
    title: "The money is held, not sent",
    body: "PayPal holds your limit. Nothing is paid until the check passes, and the rest of the hold is released.",
  },
  {
    title: "Plain code decides",
    body: "The model never makes the payment decision. A fixed check compares the offer with what you signed, and the price is fetched again from Channel3 at capture.",
  },
  {
    title: "The trap is never signable",
    body: "In the demo, a planted listing with instructions for AI agents tops every search. It is always rejected and can never be signed.",
  },
];

export function WhyItsSafe() {
  return (
    <section className={s.section} aria-labelledby="why-title">
      <h2 id="why-title">Why the agent can't spend your money</h2>
      <div className={s.howMedia}>
        <ImageSlot
          className={s.slotImage}
          src="/img/trap.webp"
          alt="A small courier robot walks past a loud roadside stall crossed out in red and takes the road through a gate held by a signed paper slip"
          width={1942}
          height={809}
          fallback={null}
        />
      </div>
      <ul className={s.points}>
        {POINTS.map((p) => (
          <li key={p.title}>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
