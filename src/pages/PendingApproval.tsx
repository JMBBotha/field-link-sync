import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import logoWhite from "@/assets/fieldlynk-logo-white.png";
import logoCard from "@/assets/fieldlynk-logo-card.png";
import { resolvePostLoginPath } from "@/lib/postLoginRedirect";
import "./auth.css";

/** Shown to company / Massair CT sign-ups until a Massair CT admin approves them. */
export default function PendingApproval() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!session) { navigate("/login"); return; }
    supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle().then(({ data }) => {
      const p: any = data;
      setStatus(p?.network_status ?? null);
      if (!p?.signup_role || p?.network_status === "approved") {
        resolvePostLoginPath(session.user.id).then(({ path }) => { if (path !== "/pending-approval") navigate(path); });
      }
    });
  }, [session, navigate]);

  return (
    <div className={`fl-auth ${dark ? "dark" : "light"}`}>
      <div className="eyebrow">0800-BE-COOL · AC SUPER SERVICE</div>
      <h1 className="t">Field <span>Lynk</span></h1>
      <div className="card">
        <div className="logo"><img src={dark ? logoWhite : logoCard} alt="0800-BE-COOL! AC Super Service" /><span className="tg">FIELD&nbsp;LYNK</span></div>
        <h2>{status === "rejected" ? "Sign-up not approved" : "Waiting for approval"}</h2>
        <p className="sub">
          {status === "rejected"
            ? "Massair CT didn't approve this sign-up. Contact them if you think this is a mistake."
            : "Thanks for signing up. Massair CT checks every new account before it goes live. You'll be able to sign in and start as soon as you're approved."}
        </p>
        <div className="trk"><button className="pill" onClick={async () => { await supabase.auth.signOut(); navigate("/login"); }}>Sign out</button></div>
      </div>
    </div>
  );
}
