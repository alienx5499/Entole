import s from "./PayPalMark.module.css";

/**
 * PayPal's official mark beside text that names PayPal: the white monotone file on dark buttons,
 * the colour file on paper. Decorative, so the text next to it carries the meaning.
 */
export function PayPalMark({ tone = "color" }: { tone?: "color" | "white" }) {
  return (
    // biome-ignore lint/performance/noImgElement: tiny static official SVG
    <img
      className={s.mark}
      src={tone === "white" ? "/paypal-logo.svg" : "/logos/paypal-color.svg"}
      alt=""
      height={16}
    />
  );
}
