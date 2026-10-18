import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Lock } from "lucide-react";
import FlAuthFrame, { PwBars } from "@/components/auth/FlAuthFrame";
import { useToast } from "@/hooks/use-toast";
import { resolvePostLoginPath } from "@/lib/postLoginRedirect";

/** Landing page for invite magic links and "Forgot password?" emails. */
export default function SetPassword() {
  const { session, loading } = useAuth();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast({ title: "Couldn't set password", description: error.message, variant: "destructive" });
    toast({ title: "Password set" });
    navigate((await resolvePostLoginPath(session!.user.id)).path, { replace: true });
  };
  return (
    <FlAuthFrame>
      <form onSubmit={save}>
        <h2>Set your password</h2>
        {loading ? <p className="sub">Loading…</p> : !session ? (
          <>
            <p className="sub">This link expired or was already used. Ask for a new invite, or use "Forgot password?" on the sign-in page.</p>
            <div className="trk"><button type="button" className="pill" onClick={() => navigate("/login")}>Back to Sign In</button></div>
          </>
        ) : (
          <>
            <p className="sub">{session.user.email}</p>
            <label className="lab" htmlFor="new-password">New password <span>8+ characters</span></label>
            <div className="f"><Lock size={18} /><input id="new-password" type="password" autoComplete="new-password" placeholder="Create a password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            <PwBars value={pw} />
            <div className="trk"><button type="submit" disabled={busy} className="pill">{busy ? "Saving…" : "Save password"}</button></div>
          </>
        )}
      </form>
    </FlAuthFrame>
  );
}
