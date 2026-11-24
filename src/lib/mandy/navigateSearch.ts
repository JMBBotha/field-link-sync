/**
 * Record lookup for navigate_to. Same tables the quote, invoice, client and job
 * screens already read, under the signed-in user's own session (RLS).
 * Phone, email and address are not copied onto the result. A client name is
 * only the on-screen chip, so a pick list can tell two rows apart.
 */
import { clientDisplayName } from "@/lib/voiceClientMatch";
import { searchClientsForVoice } from "./clientLookup";
import { canonicalInvoiceNumber, canonicalQuoteNumber, type NavHit, type NavSearch } from "./navigateTo";

type Db = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const safe = (query: string) => query.replace(/[%_\\]/g, "").trim().slice(0, 80);

export function makeNavSearch(db: Db): NavSearch {
  return {
    async search(entity, query) {
      const q = safe(query);
      if (q.length < 2) return [];
      if (entity === "client") {
        const ranked = await searchClientsForVoice(q, {
          rpc: async (fn, args) => {
            const { data, error } = await db.rpc(fn, args);
            return { data: (data as never[]) || [], error };
          },
          recentCustomers: async () => {
            const { data, error } = await db.from("customers")
              .select("id, first_name, last_name, company_name, is_company, phone, email, primary_address_line1, city, status")
              .order("updated_at", { ascending: false })
              .limit(80);
            return { data: data || [], error };
          },
        });
        return ranked.slice(0, 6).map((c): NavHit => ({
          id: c.id,
          entity: "client",
          reference: null,
          chip: clientDisplayName(c),
        }));
      }
      if (entity === "quote") {
        const num = canonicalQuoteNumber(q);
        let req = db.from("quotes").select("id, quote_number, customer_name").order("created_at", { ascending: false }).limit(6);
        req = num ? req.ilike("quote_number", `%${num}%`) : req.ilike("customer_name", `%${q}%`);
        const { data, error } = await req;
        if (error) throw new Error("lookup failed");
        return (data || []).map((r: { id: string; quote_number?: string | null; customer_name?: string | null }): NavHit => ({
          id: String(r.id),
          entity: "quote",
          reference: r.quote_number ? String(r.quote_number) : null,
          chip: `${r.quote_number || "Quote"}${r.customer_name ? ` · ${r.customer_name}` : ""}`,
        }));
      }
      if (entity === "invoice") {
        const num = canonicalInvoiceNumber(q);
        let req = db.from("invoices").select("id, invoice_number, customer_name").order("created_at", { ascending: false }).limit(6);
        req = num ? req.ilike("invoice_number", `%${num}%`) : req.ilike("customer_name", `%${q}%`);
        const { data, error } = await req;
        if (error) throw new Error("lookup failed");
        return (data || []).map((r: { id: string; invoice_number?: string | null; customer_name?: string | null }): NavHit => ({
          id: String(r.id),
          entity: "invoice",
          reference: r.invoice_number ? String(r.invoice_number) : null,
          chip: `${r.invoice_number || "Invoice"}${r.customer_name ? ` · ${r.customer_name}` : ""}`,
        }));
      }
      const { data, error } = await db.from("jobs").select("id, title").ilike("title", `%${q}%`).order("scheduled_for", { ascending: false }).limit(6);
      if (error) throw new Error("lookup failed");
      return (data || []).map((r: { id: string; title?: string | null }): NavHit => ({
        id: String(r.id),
        entity: "job",
        reference: null,
        chip: String(r.title || "Job"),
      }));
    },
  };
}
