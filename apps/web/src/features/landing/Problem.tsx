import { ScribbleLink } from "@/shared/ui";
import s from "./landing.module.css";

// Only facts from README.md, each with the source it gives.
const CARDS = [
  {
    title: "Nobody wants the loss",
    body: "In a PYMNTS Intelligence survey of about 60 US retail merchants, 93% said the AI or agent provider should cover the loss when an agent makes the wrong choice.",
    source: "PYMNTS Intelligence, 2026-09-15",
    href: "https://www.pymnts.com/?p=4190028",
  },
  {
    title: "Hidden text can steer an agent",
    body: "In an IBM demo by Crume and Keen, an agent paid $55 for a used book, about twice the expected price. Black-on-black text on the seller page told it to buy regardless of price.",
    source: "IBM demo, via StartupHub.ai",
    href: "https://www.startuphub.ai/ai-news/ai-video/2026/hidden-prompt-injection-why-ai-agents-can-be-tricked-into-overpaying-for-books/",
  },
  {
    title: "Agents obey notices in listings",
    body: "Gemini 3.1 Pro and Grok 4.5 followed a hidden notice in a product description in all 12 sessions. They added a $5 ceramic pot to every rose order, so the customer paid $45 instead of $40.",
    source: "UCP Checker, 2026-08-27",
    href: "https://ucpchecker.com/blog/what-shopping-agents-do-when-the-store-misbehaves",
  },
];

export function Problem() {
  return (
    <section className={s.section} aria-labelledby="problem-title">
      <h2 id="problem-title">The problem</h2>
      <p className={s.sectionLead}>
        AI shopping agents can now check out with PayPal. When one buys the wrong thing, the money
        has already moved.
      </p>
      <ul className={s.cards}>
        {CARDS.map((c) => (
          <li key={c.title} className="card">
            <h3>{c.title}</h3>
            <p>{c.body}</p>
            <ScribbleLink href={c.href}>{c.source}</ScribbleLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
