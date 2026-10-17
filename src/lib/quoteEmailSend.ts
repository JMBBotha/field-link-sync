import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Duplicate-send guard (Johan 17 Oct 2026, after Q-2026-0039 reached the client 6 times).
 * The server (send-quote-email + quote_email_sends) is the authority: one row per Email press,
 * a hard per-quote lock while a send is queued/sending, failures recorded with a reason.
 * This module is the app side: read that state, call the function, read its replies.
 */

export type QuoteEmailSendRow = {
  id: string;
  send_id: string;
  quote_id: string;
  kind: "quote" | "deposit";
  recipient: string;
  status: "queued" | "sending" | "sent" | "failed";
  error: string | null;
  attempts: number;
  started_at: string;
  finished_at: string | null;
};
export type QuoteEmailSendState = { active: QuoteEmailSendRow | null; last: QuoteEmailSendRow | null };

export const quoteEmailSendKey = (quoteId: string) => ["quote-email-send-state", quoteId] as const;

export async function fetchQuoteEmailSendState(quoteId: string): Promise<QuoteEmailSendState> {
  const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>;
  const { data, error } = await rpc("quote_email_send_state", { p_quote_id: quoteId });
  if (error) throw error;
  const d = (data || {}) as Partial<QuoteEmailSendState>;
  return { active: d.active ?? null, last: d.last ?? null };
}

/** Live send state for one quote; polls every 3 s while a send is queued/sending (any device/user). */
export function useQuoteEmailSendState(quoteId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: quoteEmailSendKey(quoteId || ""),
    queryFn: () => fetchQuoteEmailSendState(quoteId as string),
    enabled: enabled && !!quoteId,
    refetchInterval: (q) => ((q.state.data as QuoteEmailSendState | undefined)?.active ? 3000 : false),
    refetchOnWindowFocus: true,
    staleTime: 2000,
  });
}

/** "14:05" in SAST. */
export const sastTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }) : "";

export type SendReply =
  | { kind: "ok"; data: Record<string, unknown> }
  | { kind: "skipped"; reason: string }
  | { kind: "recent"; sentTo: string; sentAt: string }
  | { kind: "in_progress"; sentTo: string; startedAt: string }
  | { kind: "failed"; reason: string }
  | { kind: "not_configured" }
  /** No reliable answer (network/gateway): the server may still be sending. Check the send record. */
  | { kind: "unknown"; reason: string };

type Body = { success?: boolean; mock?: boolean; skipped?: boolean; code?: string; reason?: string; error?: string; message?: string; sentTo?: string; sentAt?: string; startedAt?: string; [k: string]: unknown };

/** Turns a functions.invoke result into one clear outcome. */
export async function readSendReply(data: unknown, error: unknown): Promise<SendReply> {
  if (!error) {
    const p = (data || {}) as Body;
    if (p.code === "EMAIL_NOT_CONFIGURED" || p.mock) return { kind: "not_configured" };
    if (p.skipped) return { kind: "skipped", reason: String(p.reason || "Recipient has unsubscribed.") };
    if (p.success === true) return { kind: "ok", data: p };
    return { kind: "failed", reason: String(p.reason || p.error || "The email was not sent") };
  }
  const err = error as { name?: string; message?: string; context?: Response };
  const ctx = err?.context;
  let body: Body | null = null;
  let status = 0;
  if (ctx && typeof (ctx as Response).text === "function") {
    status = (ctx as Response).status || 0;
    try { const t = await (ctx as Response).clone().text(); body = t ? JSON.parse(t) : null; } catch { body = null; }
  }
  const code = body?.code;
  if (code === "RECENTLY_SENT") return { kind: "recent", sentTo: String(body!.sentTo || ""), sentAt: String(body!.sentAt || "") };
  if (code === "SEND_IN_PROGRESS") return { kind: "in_progress", sentTo: String(body!.sentTo || ""), startedAt: String(body!.startedAt || "") };
  if (code === "EMAIL_NOT_CONFIGURED") return { kind: "not_configured" };
  if (code === "SEND_FAILED") return { kind: "failed", reason: String(body!.reason || body!.error || "The email service refused it") };
  // A JSON answer from our function with a 4xx is a real, final error.
  if (body && status >= 400 && status < 500) return { kind: "failed", reason: String(body.error || body.message || `Error ${status}`) };
  // Gateway timeouts, relay errors, dropped connections: the function may still finish the send.
  return { kind: "unknown", reason: String(body?.error || body?.message || err?.message || "No answer from the server") };
}

/** After an unclear reply: wait for this press's send record to settle (sent/failed). */
export async function waitForSendResult(quoteId: string, sendId: string, maxMs = 6 * 60 * 1000): Promise<QuoteEmailSendRow | null> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    try {
      const s = await fetchQuoteEmailSendState(quoteId);
      const mine = [s.active, s.last].find((r) => r?.send_id === sendId) || null;
      if (mine && (mine.status === "sent" || mine.status === "failed")) return mine;
      if (!mine && !s.active) return null; // never reached the server and nothing is running
    } catch { /* keep waiting */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

/* ── Same-tab lock that survives closing/reopening the dialog (and a page reload). ── */
const LOCK_MS = 6 * 60 * 1000;
const lockKey = (quoteId: string) => `fl-quote-sending:${quoteId}`;
const LOCK_EVENT = "fl-quote-send-lock";

export function setLocalSendLock(quoteId: string, sendId: string) {
  try { sessionStorage.setItem(lockKey(quoteId), JSON.stringify({ sendId, at: Date.now() })); } catch { /* private mode */ }
  window.dispatchEvent(new Event(LOCK_EVENT));
}
export function clearLocalSendLock(quoteId: string, sendId?: string) {
  try {
    const cur = getLocalSendLock(quoteId);
    if (!sendId || !cur || cur.sendId === sendId) sessionStorage.removeItem(lockKey(quoteId));
  } catch { /* ignore */ }
  window.dispatchEvent(new Event(LOCK_EVENT));
}
export function getLocalSendLock(quoteId: string): { sendId: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(lockKey(quoteId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { sendId: string; at: number };
    if (!v?.at || Date.now() - v.at > LOCK_MS) { sessionStorage.removeItem(lockKey(quoteId)); return null; }
    return v;
  } catch { return null; }
}
export const LOCAL_SEND_LOCK_EVENT = LOCK_EVENT;
