import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type EditorSurface = "builder" | "estimate";
export interface QuoteEditor { user_id: string; name: string; surface: EditorSurface; session_id: string }

/** Drop sessions this tab has taken over from; add whoever took over from this tab. */
export function visibleEditors(all: QuoteEditor[], ignored: Set<string>, takenBy: QuoteEditor | null): QuoteEditor[] {
  const list = all.filter((p) => !ignored.has(p.session_id));
  if (takenBy && !list.some((p) => p.session_id === takenBy.session_id)) list.unshift(takenBy);
  return list;
}

/**
 * Who else has this quote open (realtime presence on quote-editors:<id>).
 * Presence is per browser tab (session_id), not per user, and disappears when a tab closes.
 * takeOver(): this tab stops waiting for the listed tabs and tells them to pause their own saving.
 */
export function useQuoteEditors(quoteId: string | null | undefined, surface: EditorSurface) {
  const { session } = useAuth();
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [all, setAll] = useState<QuoteEditor[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [takenBy, setTakenBy] = useState<QuoteEditor | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const meRef = useRef<QuoteEditor | null>(null);

  useEffect(() => {
    if (!quoteId || !session) return;
    let cancelled = false;
    const user = session.user;
    const channel = supabase.channel(`quote-editors:${quoteId}`, { config: { presence: { key: sessionId } } });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const list: QuoteEditor[] = [];
        Object.values(channel.presenceState<QuoteEditor>()).forEach((ps) =>
          ps.forEach((p) => { if (p.session_id && p.session_id !== sessionId) list.push(p); }));
        if (!cancelled) setAll(list);
      })
      .on("broadcast", { event: "takeover" }, ({ payload }) => {
        const by = payload as QuoteEditor;
        if (cancelled || !by?.session_id || by.session_id === sessionId) return;
        setTakenBy(by);
        setIgnored((s) => { const n = new Set(s); n.delete(by.session_id); return n; });
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED" || cancelled) return;
        const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
        const name = (data as any)?.full_name || user.email || "Someone";
        meRef.current = { user_id: user.id, name, surface, session_id: sessionId };
        channel.track(meRef.current).catch(() => undefined);
      });
    return () => { cancelled = true; channelRef.current = null; void supabase.removeChannel(channel); setAll([]); };
  }, [quoteId, session, surface, sessionId]);

  // Whoever took over from us has left: nothing to wait for any more.
  useEffect(() => {
    if (takenBy && all.length && !all.some((p) => p.session_id === takenBy.session_id)) setTakenBy(null);
  }, [all, takenBy]);

  const takeOver = useCallback(() => {
    setIgnored(new Set(all.map((p) => p.session_id)));
    setTakenBy(null);
    const ch = channelRef.current;
    if (ch && meRef.current) void ch.send({ type: "broadcast", event: "takeover", payload: meRef.current });
  }, [all]);

  const others = useMemo(() => visibleEditors(all, ignored, takenBy), [all, ignored, takenBy]);
  return { others, takeOver, takenOver: !!takenBy };
}
