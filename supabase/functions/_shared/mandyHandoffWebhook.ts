/**
 * Mandy hand-off webhook. Pure TS (no Deno APIs) so vitest and the edge function share it.
 * The outbound JSON is the hand-off id, company, the requesting person's name and role,
 * the time, the request, and a short utterance. Client phone numbers, emails and street
 * addresses are removed. A client is named only when that name is already in the text.
 * Nothing here reads a client record.
 */

export const HUB_SIGNATURE_HEADER = "X-Hub-Signature-256";
export const HANDOFF_DEDUPE_MS = 5000;
export const HANDOFF_RETRY_DELAY_MS = 400;
export const HANDOFF_ATTEMPTS = 2;
export const HANDOFF_TIMEOUT_MS = 8000;
export const UTTERANCE_EXCERPT_CHARS = 240;
export const RESEND_UNDELIVERED_LIMIT = 25;
export const REDACTED = "[redacted]";

export const HANDOFF_WEBHOOK_KEYS = [
  "id",
  "company_id",
  "user_name",
  "role",
  "created_at",
  "summary",
  "utterance",
] as const;

export interface HandoffWebhookBody {
  id: string;
  company_id: string | null;
  user_name: string | null;
  role: string | null;
  created_at: string;
  summary: string;
  utterance: string;
}

export interface DeliveryResult {
  status: "delivered" | "failed" | "skipped";
  error: string | null;
  attempts: number;
}

export interface SavedHandoff {
  id: string;
  deduped: boolean;
  created_at: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type HandoffIdentity = {
  summary: string;
  userId: string | null;
  companyId: string | null;
};

const STREET_WORD = String.raw`(?!btu\b|unit\b|on\b|the\b|a\b|an\b|of\b|for\b|and\b|to\b|in\b|at\b|is\b|be\b)[A-Za-z][A-Za-z0-9.'’-]*`;
const STREET_SUFFIX = String.raw`(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|crescent|cres|close|boulevard|blvd|place|terrace|court)`;

/** Same rules as public.mandy_handoff_fingerprint. */
export function handoffFingerprint(summary: string): string {
  return summary
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+$/g, "")
    .toLowerCase();
}

export function withinDedupeWindow(createdAtIso: string, nowMs: number, windowMs = HANDOFF_DEDUPE_MS): boolean {
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return false;
  const age = nowMs - created;
  return age >= 0 && age < windowMs;
}

export function isNearDuplicateHandoff(existing: HandoffIdentity & { createdAt: string }, incoming: HandoffIdentity, nowMs: number): boolean {
  if ((existing.userId ?? null) !== (incoming.userId ?? null)) return false;
  if ((existing.companyId ?? null) !== (incoming.companyId ?? null)) return false;
  const fingerprint = handoffFingerprint(incoming.summary);
  if (!fingerprint || fingerprint !== handoffFingerprint(existing.summary)) return false;
  return withinDedupeWindow(existing.createdAt, nowMs);
}

export function redactHandoffText(input: string): string {
  let text = input ?? "";
  const replace = (pattern: RegExp) => {
    text = text.replace(pattern, REDACTED);
  };
  replace(/\b(?:physical address|street address|postal address|address|addr)\s*[:\-]\s*[^\n;]{4,160}/gi);
  replace(new RegExp(String.raw`,\s*[A-Za-z][A-Za-z.'’-]*(?:\s+[A-Za-z][A-Za-z.'’-]*){0,2},\s*\d{4}\b`, "gi"));
  replace(new RegExp(String.raw`\b\d{1,5}\s+${STREET_WORD}(?:\s+${STREET_WORD}){0,3}\s+${STREET_SUFFIX}\b\.?`, "gi"));
  replace(/\b(?:p\.?\s*o\.?\s*box|private bag|postnet suite)\s*[A-Za-z0-9-]*/gi);
  replace(/,\s*\d{4}\b/g);
  replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g);
  replace(/\b(?:phone|tel|cell|mobile|whatsapp|fax)\s*[:.]?\s*\+?[\d][\d\s().-]{7,}\d/gi);
  replace(/(?:\+27|0027)[\s.-]?(?:\d[\s.-]?){9}\b/g);
  replace(/\(\s*0\d{2}\s*\)[\s.-]?\d{3}[\s.-]?\d{4}\b/g);
  replace(/\b0\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g);
  replace(/\+\d{1,3}[\s.-]?(?:\d[\s.-]?){7,14}\d/g);
  replace(/\b\d{13}\b/g);
  return text
    .replace(/(?:\[redacted\][\s,;]*){2,}/g, `${REDACTED} `)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}

export function utteranceExcerpt(transcript: string | null | undefined, max = UTTERANCE_EXCERPT_CHARS): string {
  const lines = (transcript ?? "").split(/\n/).map((line) => line.trim()).filter(Boolean);
  const userLines = lines.filter((line) => /^user\s*:/i.test(line)).map((line) => line.replace(/^user\s*:\s*/i, ""));
  const source = userLines.length
    ? userLines[userLines.length - 1]
    : lines.filter((line) => !/^mandy\s*:/i.test(line)).join(" ");
  const clean = redactHandoffText(source).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function scrubName(name: string | null | undefined): string | null {
  const clean = redactHandoffText(name ?? "").replace(/\s+/g, " ").trim();
  if (!clean || clean === REDACTED) return null;
  return clean;
}

export function toIsoTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error("created_at is not a timestamp");
  return new Date(parsed).toISOString();
}

export function buildHandoffWebhookBody(input: {
  id: string;
  company_id: string | null;
  user_name: string | null;
  role: string | null;
  created_at: string;
  summary: string;
  transcript?: string | null;
}): { body: HandoffWebhookBody; raw: string } {
  const body: HandoffWebhookBody = {
    id: input.id,
    company_id: input.company_id,
    user_name: scrubName(input.user_name),
    role: input.role,
    created_at: toIsoTimestamp(input.created_at),
    summary: redactHandoffText(input.summary),
    utterance: utteranceExcerpt(input.transcript),
  };
  return { body, raw: JSON.stringify(body) };
}

export function asSavedHandoff(data: unknown): SavedHandoff | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.created_at !== "string" || !row.created_at) return null;
  return { id: row.id, deduped: row.deduped === true, created_at: row.created_at };
}

export async function hubSignature256(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

export async function signedWebhookHeaders(secret: string, rawBody: string): Promise<Record<string, string>> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
    [HUB_SIGNATURE_HEADER]: await hubSignature256(secret, rawBody),
  };
}

export function deliveryErrorText(text: string, secret: string): string {
  let out = redactHandoffText(text);
  if (secret) out = out.split(secret).join(REDACTED);
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > 400) out = `${out.slice(0, 399).trimEnd()}…`;
  return out;
}

function configuredTarget(url: string | null | undefined, secret: string | null | undefined): { url: string; secret: string } | DeliveryResult {
  const hook = (url ?? "").trim();
  const key = (secret ?? "").trim();
  if (!hook) return { status: "skipped", error: "MANDY_HANDOFF_WEBHOOK_URL is not set", attempts: 0 };
  if (!key) return { status: "skipped", error: "MANDY_HANDOFF_WEBHOOK_SECRET is not set", attempts: 0 };
  let parsed: URL;
  try {
    parsed = new URL(hook);
  } catch {
    return { status: "failed", error: "webhook url is not a valid URL", attempts: 0 };
  }
  if (parsed.protocol !== "https:") return { status: "failed", error: "webhook url must be https", attempts: 0 };
  return { url: parsed.toString(), secret: key };
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export async function postHandoffWebhook(opts: {
  url: string | null | undefined;
  secret: string | null | undefined;
  rawBody: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retryDelayMs?: number;
}): Promise<DeliveryResult> {
  const target = configuredTarget(opts.url, opts.secret);
  if ("status" in target) return target;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutMs ?? HANDOFF_TIMEOUT_MS;
  const retryDelayMs = opts.retryDelayMs ?? HANDOFF_RETRY_DELAY_MS;
  const headers = await signedWebhookHeaders(target.secret, opts.rawBody);
  let lastError = "request failed";
  for (let attempt = 1; attempt <= HANDOFF_ATTEMPTS; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(target.url, {
          method: "POST",
          headers,
          body: opts.rawBody,
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 200 && res.status < 300) {
        return { status: "delivered", error: null, attempts: attempt };
      }
      const body = await readErrorBody(res);
      lastError = deliveryErrorText(`HTTP ${res.status}${body ? `: ${body}` : ""}`, target.secret);
    } catch (err) {
      const message = err instanceof Error ? (err.name === "AbortError" ? "timed out" : err.message || err.name) : "request failed";
      lastError = deliveryErrorText(message, target.secret) || "request failed";
    }
    if (attempt < HANDOFF_ATTEMPTS) await sleep(retryDelayMs);
  }
  return { status: "failed", error: `after ${HANDOFF_ATTEMPTS} attempts: ${lastError}`, attempts: HANDOFF_ATTEMPTS };
}

export function isUndeliveredOpen(row: { status?: string | null; webhook_status?: string | null }): boolean {
  return row.status === "open" && row.webhook_status !== "delivered";
}

export async function resendUndelivered<T extends { status?: string | null; webhook_status?: string | null }>(
  rows: T[],
  deliver: (row: T) => Promise<DeliveryResult>,
): Promise<{ ok: true; considered: number; delivered: number; failed: number; skipped: number }> {
  const open = rows.filter(isUndeliveredOpen);
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of open) {
    const result = await deliver(row);
    if (result.status === "delivered") delivered += 1;
    else if (result.status === "skipped") skipped += 1;
    else failed += 1;
  }
  return { ok: true, considered: open.length, delivered, failed, skipped };
}

/** Start work after the HTTP reply. Does not wait for it. */
export function scheduleAfterReply(task: Promise<unknown>, waitUntil?: (promise: Promise<unknown>) => void): void {
  const tracked = task.then(() => undefined, () => undefined);
  if (typeof waitUntil === "function") waitUntil(tracked);
  else void tracked;
}

export function currentWaitUntil(): ((promise: Promise<unknown>) => void) | undefined {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof runtime?.waitUntil !== "function") return undefined;
  return runtime.waitUntil.bind(runtime);
}
