import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import logo from "@/assets/logo.png";

// The @supabase/supabase-js `auth.oauth` namespace is beta and not always in the
// generated types — narrow it locally so this page stays typed.
type OAuthClient = { name?: string; client_uri?: string; logo_uri?: string };
type AuthorizationDetails = {
  client?: OAuthClient;
  scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
};
type OAuthApi = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("No redirect returned by the authorization server.");
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)] p-4">
      <img src={logo} alt="0800BeCool" className="h-16 w-auto mb-6 drop-shadow-lg" />
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-4">
        {error ? (
          <>
            <h1 className="text-xl font-bold text-red-600">Authorization error</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </>
        ) : !details ? (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading authorization…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[hsl(204,100%,36%)]/10 text-[hsl(204,100%,36%)]">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold">
                  Connect {details.client?.name ?? "an app"} to your account
                </h1>
                <p className="text-xs text-muted-foreground">
                  This lets {details.client?.name ?? "the client"} access your field service data
                  as you.
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-700">
              Access is limited by row-level security to the resources your account already sees
              (leads, jobs, customers, quotes, invoices).
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Deny
              </Button>
              <Button
                className="flex-1 bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,45%)] text-white"
                disabled={busy}
                onClick={() => decide(true)}
              >
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Approve
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
