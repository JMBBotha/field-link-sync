import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type EditorSurface = "builder" | "estimate";
export interface QuoteEditor { user_id: string; name: string; surface: EditorSurface; session_id: string }

/** Who else has this quote open (realtime presence on quote-editors:<id>). */
export function useQuoteEditors(quoteId: string | null | undefined, surface: EditorSurface) {
  const { session } = useAuth();
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [others, setOthers] = useState<QuoteEditor[]>([]);

  useEffect(() => {
    if (!quoteId || !session) return;
    let cancelled = false;
    const user = session.user;
    const channel = supabase.channel(`quote-editors:${quoteId}`, { config: { presence: { key: sessionId } } });
    channel
      .on("presence", { event: "sync" }, () => {
        const list: QuoteEditor[] = [];
        Object.values(channel.presenceState<QuoteEditor>()).forEach((ps) =>
          ps.forEach((p) => { if (p.session_id && p.session_id !== sessionId) list.push(p); }));
        if (!cancelled) setOthers(list);
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED" || cancelled) return;
        const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
        const name = (data as any)?.full_name || user.email || "Someone";
        channel.track({ user_id: user.id, name, surface, session_id: sessionId }).catch(() => undefined);
      });
    return () => { cancelled = true; void supabase.removeChannel(channel); setOthers([]); };
  }, [quoteId, session, surface, sessionId]);

  return { others };
}
