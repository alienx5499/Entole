import { ScribbleLink } from "@/shared/ui";
import s from "./landing.module.css";

const REPO_URL = "https://github.com/alienx5499/Entole";

export function LandingFooter() {
  return (
    <footer className={s.footer}>
      <ScribbleLink href={REPO_URL}>Source on GitHub</ScribbleLink>
      <span>MIT licence</span>
      <span>Sandbox demo, no real money</span>
    </footer>
  );
}
