import s from "./landing.module.css";

// The services and sponsors Entole runs on; logos are the official files listed in public/README-assets.md.
const TOOLS = [
  {
    name: "PayPal",
    href: "https://developer.paypal.com",
    use: "Orders, hold and capture, Log in with PayPal",
    logo: "paypal-color.svg",
  },
  {
    name: "Channel3",
    href: "https://trychannel3.com",
    use: "Product search, price history and product subscriptions",
    logo: "channel3.svg",
    wordmark: true,
  },
  {
    name: "AG Grid",
    href: "https://www.ag-grid.com",
    use: "Dashboard grid, charts and AG Studio",
    logo: "ag-grid.svg",
    wordmark: true,
  },
  {
    name: "Bryntum",
    href: "https://bryntum.com",
    use: "Order schedule timeline",
    logo: "bryntum.webp",
    wordmark: true,
  },
  {
    name: "APIMatic",
    href: "https://www.apimatic.io",
    use: "PayPal Server SDK and Context Plugin",
    logo: "apimatic.svg",
    wordmark: true,
  },
  { name: "Render", href: "https://render.com", use: "Hosts the API", logo: "render.svg" },
  {
    name: "Groq",
    href: "https://groq.com",
    use: "The shopping agent's model",
    logo: "groq.svg",
    wordmark: true,
  },
  { name: "Neon", href: "https://neon.com", use: "Postgres database", logo: "neon.svg" },
  { name: "Vercel", href: "https://vercel.com", use: "Hosts the web app", logo: "vercel.svg" },
];

export function BuiltWith() {
  return (
    <section className={s.section} aria-labelledby="built-title">
      <h2 id="built-title">Built with</h2>
      <ul className={s.chips}>
        {TOOLS.map((t) => (
          <li key={t.name}>
            <a
              className={s.logoChip}
              href={t.href}
              title={t.use}
              target="_blank"
              rel="noopener noreferrer"
            >
              {/* Wordmark logos already show the name, so the text is for screen readers only. */}
              {/* biome-ignore lint/performance/noImgElement: small static brand SVGs */}
              <img
                src={`/logos/${t.logo}`}
                alt={"wordmark" in t ? t.name : ""}
                className={s.logoImg}
                height={18}
              />
              {!("wordmark" in t) && <span>{t.name}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
