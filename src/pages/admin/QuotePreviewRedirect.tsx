import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/** /admin/quote-preview/:id -> the client's own quote page in staff preview (p111, Johan t2039u).
 *  Reads the token under the staff login's RLS; ?preview=1 skips the "viewed" mark and hides client buttons. */
export default function QuotePreviewRedirect() {
  const { id } = useParams<{ id: string }>(); const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("quotes").select("public_token").eq("id", id).maybeSingle();
      if (!data?.public_token) { setErr("This quote has no client link yet."); return; }
      navigate(`/quote/${encodeURIComponent(data.public_token)}?preview=1`, { replace: true });
    })();
  }, [id, navigate]);
  return <div className="p-6 text-sm text-muted-foreground">{err ? <>{err} <Link className="text-primary underline" to={`/admin/estimates/${id}`}>Edit quote</Link></> : "Opening client view…"}</div>;
}
