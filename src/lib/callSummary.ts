// Call summaries: a short line (want · area · urgency · next) instead of the raw Mandy/Vapi notes dump.
// Prefers leads.call_summary (filled in the DB from the Grok call_reports); otherwise parses the notes.
export type CallLeadLike = {
  notes?: string | null; call_summary?: string | null; call_area?: string | null;
  call_urgency?: string | null; call_next_action?: string | null;
};
export type ParsedCall = {
  firstRequest: string | null; durationSec: number | null; recordingUrl: string | null; endedReason: string | null;
  callId: string | null; source: string | null; aiSummary: string | null; transcript: string[];
};

const FILLER = /^(hi|hello|hey|yes|yeah|yep|no|nope|ok|okay|bye|thanks|thank you|good|great|sure|fine|fee)\b[\s.!?,]*$/i;
const META = /^(Source:|Ended reason:|Call duration:|Recording:|Vapi call:|---|Transcript:|AI:|User:|Booked by phone|⭐)/i;

export const isCallDump = (notes?: string | null) =>
  !!notes && /(^|\n)\s*(Transcript:\s*)?(User|AI):|CallSid:|Vapi call:|Ended reason:|Recording: https?:/i.test(notes);

export const isTestLead = (name?: string | null) => /\b(test|dummy|qa|e2e|rls)\b/i.test(name || "");

export function parseCall(notes?: string | null): ParsedCall {
  const text = notes || "";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const transcript = lines.map((l) => l.replace(/^Transcript:\s*/i, "")).filter((l) => /^(User|AI):/i.test(l));
  const said = transcript.filter((l) => /^User:/i.test(l)).map((l) => l.replace(/^User:\s*/i, "").trim());
  const firstRequest = said.find((u) => u.split(/\s+/).length >= 3 && !FILLER.test(u)) ?? said.find((u) => u && !FILLER.test(u)) ?? null;
  const dur = text.match(/Call duration:\s*([\d.]+)s/i) || text.match(/End-of-call update \(([\d.]+)s/i);
  const ended = text.match(/Ended reason:\s*([^\n]+)/i) || text.match(/End-of-call update \([\d.]+s,\s*([^)]+)\)/i);
  return {
    firstRequest,
    durationSec: dur ? Math.round(Number(dur[1])) : null,
    recordingUrl: text.match(/Recording:\s*(https?:\/\/\S+)/i)?.[1] ?? null,
    endedReason: ended?.[1]?.trim() ?? null,
    callId: (text.match(/CallSid:\s*([\w-]+)/i) || text.match(/Vapi call:\s*([\w-]+)/i))?.[1] ?? null,
    source: text.match(/Source:\s*([\w-]+)/i)?.[1] ?? null,
    aiSummary: lines.find((l) => !META.test(l)) ?? null,
    transcript,
  };
}

export const fmtDuration = (s: number | null) =>
  s == null ? null : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;

const clip = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Short one-line summary for cards, popovers and bells. */
export function oneLineSummary(lead: CallLeadLike): string | null {
  if (lead.call_summary?.trim()) return clip(lead.call_summary.trim());
  const notes = lead.notes?.trim();
  if (!notes) return null;
  if (!isCallDump(notes)) return clip(notes.split(/\r?\n/)[0]);
  const p = parseCall(notes);
  const d = fmtDuration(p.durationSec);
  const head = p.firstRequest ? `“${clip(p.firstRequest, 110)}”` : p.aiSummary ? clip(p.aiSummary, 110) : "Phone call";
  return d ? `${head} · ${d}` : head;
}

export const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Map popover HTML (escaped): the one line plus a native "Show full call" expander. */
export function callSummaryHtml(lead: CallLeadLike): string {
  const line = oneLineSummary(lead);
  if (!line) return "";
  const full = isCallDump(lead.notes)
    ? `<details style="margin-top:4px"><summary style="cursor:pointer;color:#2563eb;font-size:11px">Show full call</summary><div style="white-space:pre-wrap;max-height:160px;overflow:auto;font-size:10px;color:#6b7280;margin-top:4px">${escapeHtml(lead.notes)}</div></details>`
    : "";
  return `<span style="font-size:11px;color:#374151">${escapeHtml(line)}</span>${full}`;
}
