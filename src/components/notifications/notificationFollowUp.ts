const STORAGE_KEY = "notif-followup-done";

/** Notification types that require the user to open the linked record first. */
export const requiresFollowUp = (type: string): boolean => {
  const t = (type || "").toLowerCase();
  return (
    t.includes("quote") ||
    t.includes("estimate") ||
    t.includes("proposal") ||
    t.includes("invoice") ||
    t.includes("payment") ||
    t.includes("job") ||
    t.includes("assignment") ||
    t.includes("dispatch") ||
    t.includes("lead")
  );
};

const readSet = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
};

export const getFollowUpIds = (): Set<string> => readSet();

export const markFollowUpDone = (id: string) => {
  try {
    const set = readSet();
    set.add(id);
    // keep the list bounded
    const arr = Array.from(set).slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
};

const CLOSED_LEAD = new Set(["accepted", "resolved_before_visit", "completed", "lost", "cancelled"]);

/** Lead id carried by a New Lead, Call Logged, or hot-lead alert. */
export const alertLeadId = (n: { type?: string | null; related_id?: string | null; metadata?: { lead_id?: string | null; entity?: string | null } | null }): string | null => {
  const t = (n.type || "").toLowerCase();
  if (t === "call_logged") return typeof n.metadata?.lead_id === "string" ? n.metadata.lead_id : null;
  if (t === "new_lead" || t === "lead_assigned" || t.startsWith("lead_") || (t === "sales_nudge" && n.metadata?.entity !== "quote")) {
    return n.related_id || null;
  }
  return null;
};

export const leadIsClosedForAlert = (lead?: {
  dismissed_at?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
  status?: string | null;
  lead_status?: string | null;
} | null): boolean => {
  if (!lead) return false;
  if (lead.dismissed_at || lead.closed_at || lead.archived_at) return true;
  return CLOSED_LEAD.has((lead.status || "").toLowerCase()) || CLOSED_LEAD.has((lead.lead_status || "").toLowerCase());
};

/** A New Lead for a lead that is already closed is not locked as "needs follow-up". */
export const leadAlertAlreadyClosed = (n: { metadata?: { lead_closed?: boolean } | null }): boolean =>
  n.metadata?.lead_closed === true;

export const canMarkRead = (
  n: { id: string; type: string; metadata?: { lead_closed?: boolean } | null },
  done: Set<string>
): boolean => leadAlertAlreadyClosed(n) || !requiresFollowUp(n.type) || done.has(n.id);
