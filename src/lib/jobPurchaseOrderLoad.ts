import { supabase } from "@/integrations/supabase/client";
import type { LinkedPo } from "@/lib/jobPurchaseOrder";

/** Purchase orders for these jobs. Falls back if the new columns are not on the database yet. */
export async function loadJobPos(companyId: string, jobIds: string[]): Promise<LinkedPo[]> {
  if (!jobIds.length) return [];
  const db = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          in: (col: string, value: string[]) => {
            neq: (col: string, value: string) => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
        };
      };
    };
  };
  const run = (cols: string) => db.from("purchase_orders").select(cols).eq("company_id", companyId).in("job_id", jobIds).neq("status", "cancelled");
  const full = await run("id, job_id, company_id, po_number, status, sent_at, created_at, items:purchase_order_items(product_id, quote_item_id, qty)");
  const data = (!full.error ? full.data : (await run("id, job_id, company_id, po_number, status, created_at, items:purchase_order_items(product_id, qty)")).data) as Record<string, unknown>[] | null;
  return (data || []).map((row) => ({
    id: String(row.id),
    jobId: String(row.job_id),
    companyId: row.company_id == null ? null : String(row.company_id),
    poNumber: String(row.po_number || ""),
    status: String(row.status || ""),
    sentAt: row.sent_at == null ? null : String(row.sent_at),
    createdAt: row.created_at == null ? null : String(row.created_at),
    lines: (Array.isArray(row.items) ? row.items : []).map((item) => {
      const line = item as Record<string, unknown>;
      return {
        quoteItemId: line.quote_item_id == null ? null : String(line.quote_item_id),
        productId: line.product_id == null ? null : String(line.product_id),
        qty: Number(line.qty) || 0,
      };
    }),
  }));
}
