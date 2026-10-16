import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import logoWhite from "@/assets/fieldlynk-logo-white.png";
import logoCard from "@/assets/fieldlynk-logo-card.png";
import "@/pages/auth.css";

/** Shared logged-out frame (same look as the new sign-in): blues, orange accent, logo card, dark + light. */
export default function FlAuthFrame({ children, wide, logo = true }: { children: React.ReactNode; wide?: boolean; logo?: boolean }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <div className={`fl-auth ${dark ? "dark" : "light"}`}>
      <button type="button" className="theme" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <div className="eyebrow">0800-BE-COOL · AC SUPER SERVICE</div>
      <h1 className="t">Field <span>Lynk</span></h1>
      <div className={`card${wide ? " wide" : ""}`}>
        {logo && <div className="logo"><img src={dark ? logoWhite : logoCard} alt="0800-BE-COOL! AC Super Service" /><span className="tg">FIELD&nbsp;LYNK</span></div>}
        {children}
      </div>
      <div className="foot">FIELD LYNK · 0800-232-665</div>
    </div>
  );
}
