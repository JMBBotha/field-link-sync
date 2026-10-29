import { supabase } from "@/integrations/supabase/client";

export type RequestType = "new_sale" | "service" | "move" | "admin";
export const REQUEST_TYPES: { v: RequestType; l: string; hint: string }[] = [
  { v: "new_sale", l: "New sale", hint: "Lead to a rep" },
  { v: "service", l: "Service", hint: "Tech job" },
  { v: "move", l: "Move", hint: "Internal sale · client's rep" },
  { v: "admin", l: "Admin", hint: "Task due today" },
];
export const typeLabel = (t: string | null | undefined) => REQUEST_TYPES.find((x) => x.v === t)?.l ?? "Needs sorting";

export interface RequestRow {
  id: string; masked: boolean; source: string; type: RequestType | null; suggested_type: RequestType | null; type_confidence?: number | null;
  sorted_by?: string | null; sort_reason?: string | null; status: string; customer_id?: string | null; lead_id?: string | null; job_id?: string | null;
  customer_name?: string | null; phone?: string | null; area?: string | null; summary?: string | null; routed_to?: string | null;
  assigned_to?: string | null; assigned_name?: string | null; scheduled_for?: string | null; first_contact_at?: string | null; contacted?: boolean; contact_channel?: string | null;
  task_due_at?: string | null; done_at?: string | null; created_at: string; owner_rep_name?: string | null; mine?: boolean;
  working_min_waiting?: number | null; not_contacted_red?: boolean; unscheduled_nudge?: boolean; task_overdue?: boolean;
}
export interface TodayCounts {
  in: number; needs_sorting: number; not_contacted_red: number; mine_today: number;
  types: Record<RequestType, { in: number; contacted: number; assigned: number }>;
}
type Res = { ok: boolean; message?: string; request_id?: string; lead_id?: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any)(fn, args);
async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const fetchInbox = (days = 30) => call<RequestRow[]>("requests_inbox", { p_days: days });
export const fetchToday = () => call<TodayCounts | null>("requests_today_counts");
export const setType = (id: string, t: RequestType) => call<Res>("request_set_type", { p_request_id: id, p_type: t });
export const markContacted = (id: string, ch = "phone") => call<Res>("request_mark_contacted", { p_request_id: id, p_channel: ch });
export const markDone = (id: string) => call<Res>("request_mark_done", { p_request_id: id });
export const createRequest = (a: { type: RequestType; name: string; phone?: string; area?: string; text?: string; customerId?: string | null }) =>
  call<Res>("request_create", { p_type: a.type, p_name: a.name, p_phone: a.phone || null, p_area: a.area || null, p_text: a.text || null, p_customer_id: a.customerId ?? null });
export const setOwnerRep = (customerId: string, repId: string | null, reason: string) =>
  call<Res>("set_customer_owner_rep", { p_customer_id: customerId, p_rep_id: repId, p_reason: reason });
export const topCorrections = (days = 7) => call<{ word: string; type: RequestType; n: number }[]>("request_top_corrections", { p_days: days });
export const addKeyword = (t: RequestType, kw: string) => call<Res>("request_add_keyword", { p_type: t, p_keyword: kw });

export function waitLabel(min?: number | null) {
  if (min == null) return "";
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
}
