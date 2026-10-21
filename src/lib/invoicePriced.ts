// Send/issue guard for invoices (Johan 2026-10-21): drafts may hold unpriced lines; nothing goes to a client with an R0 line.
import { supabase } from "@/integrations/supabase/client";
import { r0FormOffenders } from "@/lib/zeroPriceGuard";
import { r0Summary } from "@/lib/r0Highlight";

export async function invoiceMissingPrices(invoiceId: string, db: any = supabase): Promise<string | null> {
  const { data: items } = await db.from("invoice_items").select("description, line_name, room_label, line_type, unit_price, quantity").eq("invoice_id", invoiceId);
  let rows: any[] = (items || []).filter((r: any) => r.line_type !== "deposit");
  if (!rows.length) {
    const { data: inv } = await db.from("invoices").select("line_items").eq("id", invoiceId).maybeSingle();
    rows = ((inv?.line_items || []) as any[]).filter((r) => r.line_type !== "deposit");
  }
  const offs = r0FormOffenders(rows.map((r) => ({ description: r.line_name || r.description, rate: r.unit_price ?? r.rate, room_label: r.room_label })));
  return offs.length ? `Enter a price for ${r0Summary(offs)} before sending (open the invoice and edit it).` : null;
}
