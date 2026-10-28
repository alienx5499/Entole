import { CurveSpinner, ImageSlot, PayPalLoginButton, ScribbleLink } from "@/shared/ui";
import { HeroArt } from "./HeroArt";
import s from "./landing.module.css";

/**
 * Logged-in visitors get a link into the app instead of the PayPal login button.
 * `null` means the login check is still running: a small loader holds the button's place.
 */
export function Hero({ signedIn }: { signedIn: boolean | null }) {
  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={s.heroText}>
        <h1 id="hero-title">Tell it your price. Agent shops, your signature pays.</h1>
        <p className={s.lead}>
          You set the most you will pay and sign one PayPal hold for a short list of items. An AI
          agent picks the list, but it cannot spend anything. When a price drops to your limit,
          plain code checks it and PayPal pays for that one item.
        </p>
        <div className={s.actions}>
          {signedIn === null ? (
            <span className={s.ctaPending} role="status" aria-label="Checking your login">
              <CurveSpinner palette="ink" />
            </span>
          ) : signedIn ? (
            <a className="btn btn-primary" href="/mandates/new">
              Start a limit order
            </a>
          ) : (
            <PayPalLoginButton sandboxNote message />
          )}
          <ScribbleLink href="#how-it-works">See how it works</ScribbleLink>
        </div>
      </div>
      <div className={s.heroMedia}>
        <ImageSlot
          className={s.slotImage}
          src="/img/hero.webp"
          alt="A price line falling to the buyer's limit, where Entole buys"
          width={1200}
          height={800}
          priority
          fallback={<HeroArt />}
        />
      </div>
    </section>
  );
}
