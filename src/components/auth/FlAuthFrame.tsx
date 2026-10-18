import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import logoCard from "@/assets/fieldlynk-logo-card.png";
import "@/pages/auth.css";

export const AUTH_TITLE = "Field Lynk Sync";
export const AUTH_FOOT = "SECURE SIGN-IN · WWW.0800BECOOL.CO.ZA";

/** Glowing 0800-BE-COOL logo that sits above the auth card (the only logo on logged-out pages). */
export function AuthOrb() {
  return <div className="orb"><img src={logoCard} alt="0800-BE-COOL! AC Super Service" /></div>;
}

/** Display-only password strength (0–3 bars). Never blocks submit; validation stays on the input. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let s = pw.length >= 8 ? 1 : 0;
  if (s && /[a-zA-Z]/.test(pw) && /\d/.test(pw)) s++;
  if (s === 2 && (/[^a-zA-Z0-9]/.test(pw) || pw.length >= 12)) s++;
  return Math.max(1, s) as 1 | 2 | 3;
}
export function PwBars({ value }: { value: string }) {
  return <div className="pwbars" data-s={passwordStrength(value)} aria-hidden="true"><i /><i /><i /></div>;
}

/** Shared logged-out frame (same look as sign-in): dark glass card, glowing logo, V8 blue; dark + light. */
export default function FlAuthFrame({ children, wide, logo = true }: { children: React.ReactNode; wide?: boolean; logo?: boolean }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <div className={`fl-auth ${dark ? "dark" : "light"}`}>
      <button type="button" className="theme" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      {logo && <AuthOrb />}
      <div className={`card${wide ? " wide" : ""}`}>
        <h1 className="t">{AUTH_TITLE}</h1>
        {children}
      </div>
      <div className="foot">{AUTH_FOOT}</div>
    </div>
  );
}
