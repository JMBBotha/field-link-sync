/**
 * One loader for every "Create invoice" from a job (lead). Office-only screen.
 * Fills: linked quote lines at the quote's own prices, a credit line per deposit invoice,
 * tech extras / parts used (flagged, catalogue SELL price, never cost; unknown items R0),
 * labour over the quoted hours, and reference notes. Nothing is saved here.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildQuoteLineItems } from "@/lib/convertQuoteToInvoice";
import { isLabourItem } from "@/lib/labour";
import { parseExtras } from "@/lib/overrun";
import type { ProductOption } from "@/hooks/useProductOptions";

export type AutofillFlag = "tech" | "credit";
export interface AutofillLine { description: string; quantity: number; rate: number; markup: number; amount: number; flag?: AutofillFlag }
export interface QuoteSuggestion { id: string; quote_number: string | null; status: string; total: number }

const db = supabase as any;
const r2 = (n: number) => Math.round(n * 100) / 100;
const Q = "id, quote_number, status, total, created_at, visual_sections";

async function loadRaw(leadId: string, quoteChoice: string | null) {
  const { data: lead } = await db.from("leads").select("id, customer_id, completed_at").eq("id", leadId).maybeSingle();
  const customerId: string | null = lead?.customer_id ?? null;
  let quote: any = null;
  if (quoteChoice) {
    quote = (await db.from("quotes").select(Q).eq("id", quoteChoice).maybeSingle()).data;
  } else {
    // Same rule as lead_invoice_status: accepted first, else latest live quote.
    const { data } = await db.from("quotes").select(Q).eq("lead_id", leadId).neq("status", "declined").is("superseded_by", null).order("created_at", { ascending: false }).limit(20);
    quote = (data || []).find((q: any) => q.status === "accepted") || (data || [])[0] || null;
  }
  let suggestions: QuoteSuggestion[] = [];
  if (!quote && customerId) {
    const { data } = await db.from("quotes").select("id, quote_number, status, total").eq("customer_id", customerId).neq("status", "declined").is("superseded_by", null).order("created_at", { ascending: false }).limit(5);
    suggestions = (data || []).map((q: any) => ({ id: q.id, quote_number: q.quote_number, status: q.status, total: Number(q.total) || 0 }));
  }
  const [quoteLines, labourRes, depRes, ovRes, partsRes, compRes, timeRes] = await Promise.all([
    quote ? buildQuoteLineItems(quote.id, quote.visual_sections) : Promise.resolve([]),
    quote ? db.from("quote_items").select("item_type, metadata, quantity, unit_price, parent_item_id").eq("quote_id", quote.id).eq("item_type", "labour") : Promise.resolve({ data: [] }),
    quote ? db.from("invoices").select("invoice_number, subtotal, grand_total, notes, status").eq("quote_id", quote.id) : Promise.resolve({ data: [] }),
    db.from("job_overruns").select("actual_hours, extra_items, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
    db.from("job_used_parts").select("product_id, product_name, product_code, quantity").eq("lead_id", leadId),
    db.from("job_completions").select("work_summary, customer_name, signed_at, completed_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
    db.from("job_time_entries").select("hours_onsite, travel_hours, is_billable").eq("lead_id", leadId),
  ]);
  const labour = ((labourRes.data || []) as any[]).filter((i) => !i.parent_item_id && isLabourItem(i));
  const deposits = ((depRes.data || []) as any[]).filter((i) => String(i.notes || "").startsWith("DEPOSIT") && !["void", "cancelled"].includes(i.status || ""));
  return {
    key: `${leadId}:${quote?.id || "none"}`, customerId, completedAt: (lead?.completed_at as string) || null,
    quote, suggestions, quoteLines, labour, deposits,
    overrun: ((ovRes.data || []) as any[])[0] || null, parts: (partsRes.data || []) as any[],
    completion: ((compRes.data || []) as any[])[0] || null, time: (timeRes.data || []) as any[],
  };
}

export function useInvoiceAutofill(leadId: string | null | undefined, quoteChoice: string | null, products: ProductOption[], defaultRate: number) {
  const { data: raw } = useQuery({
    queryKey: ["invoice-autofill", leadId, quoteChoice],
    enabled: !!leadId,
    staleTime: Infinity,
    queryFn: () => loadRaw(leadId as string, quoteChoice),
  });
  const productsReady = products.some((p) => p.source === "product");
  return useMemo(() => {
    if (!raw || !leadId) return null;
    const extras = parseExtras(raw.overrun?.extra_items).filter((x) => x.qty > 0);
    if (!productsReady && (extras.some((x) => x.product_id) || raw.parts.some((p) => p.product_id))) return null; // wait for sell prices
    const sell = (id: string | null | undefined) => (id ? products.find((p) => p.source === "product" && p.id === id)?.rate ?? 0 : 0);
    const line = (description: string, quantity: number, rate: number, flag?: AutofillFlag): AutofillLine =>
      ({ description, quantity, rate: r2(rate), markup: 0, amount: r2(quantity * rate) * (flag === "credit" ? -1 : 1), flag });
    const lines: AutofillLine[] = raw.quoteLines.map((q) => ({ ...q, markup: 0 }));
    for (const d of raw.deposits) {
      const ex = r2(d.subtotal != null ? Number(d.subtotal) : (Number(d.grand_total) || 0) / 1.15);
      if (ex > 0) lines.push(line(`Less: deposit invoiced ${d.invoice_number}`, 1, ex, "credit"));
    }
    for (const x of extras) lines.push(line(x.name, x.qty, sell(x.product_id), "tech"));
    for (const p of raw.parts) lines.push(line(`${p.product_name}${p.product_code ? ` (${p.product_code})` : ""}`, Number(p.quantity) || 1, sell(p.product_id), "tech"));
    const actual = raw.overrun?.actual_hours != null ? Number(raw.overrun.actual_hours) : null;
    if (raw.quote) {
      const quoted = raw.labour.reduce((s, i) => s + (Number(i.metadata?.hours ?? i.quantity) || 0), 0);
      const rate = Number(raw.labour[0]?.unit_price) || defaultRate || 0;
      const over = actual != null ? r2(actual - quoted) : 0;
      if (over > 0) lines.push(line(`Additional labour (over quoted ${quoted} h)`, over, rate, "tech"));
    } else {
      const logged = raw.time.filter((t) => t.is_billable !== false).reduce((s, t) => s + Number(t.hours_onsite || 0) + Number(t.travel_hours || 0), 0);
      const hours = r2(actual ?? logged);
      if (hours > 0) lines.push(line("Labour", hours, defaultRate || 0, "tech"));
    }
    const done = raw.completion?.completed_at || raw.completedAt;
    const ref = [raw.quote?.quote_number && `Ref: ${raw.quote.quote_number}`, `Job ${leadId.slice(0, 8).toUpperCase()}`,
      done && `Work completed ${new Date(done).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" })}`].filter(Boolean).join(" · ");
    const notes = [ref, raw.completion?.work_summary, raw.completion?.signed_at && raw.completion?.customer_name && `Signed off by ${raw.completion.customer_name}`].filter(Boolean).join("\n");
    return { key: raw.key, customerId: raw.customerId, quoteId: (raw.quote?.id as string) || null, suggestions: raw.suggestions, lines, notes };
  }, [raw, leadId, products, productsReady, defaultRate]);
}
