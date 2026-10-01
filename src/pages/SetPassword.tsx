import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="min-h-screen flex items-center justify-center bg-[hsl(216,58%,12%)] p-4">
      <form onSubmit={save} className="w-full max-w-sm space-y-4 rounded-xl bg-white/10 p-6 text-white">
        <h1 className="text-xl font-bold">Set your password</h1>
        {loading ? <p>Loading…</p> : !session ? (
          <>
            <p className="text-sm text-white/70">This link expired or was already used. Ask for a new invite, or use "Forgot password?" on the sign-in page.</p>
            <Button type="button" className="w-full" onClick={() => navigate("/login")}>Back to Sign In</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-white/70">{session.user.email}</p>
            <Input type="password" autoComplete="new-password" placeholder="New password (min 8)" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} className="bg-white/10 text-white" />
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Saving…" : "Save password"}</Button>
          </>
        )}
      </form>
    </div>
  );
}
