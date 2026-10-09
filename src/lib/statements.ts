import { formatRand } from "@/utils/formatRand";

export interface StatementRow {
  date: string;
  type: "invoice" | "payment" | "credit_note";
  ref: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
  invoice_id?: string;
}
export interface Statement {
  customer: { id?: string; name: string | null; company_name: string | null; address: string | null; vat_number: string | null };
  company: { company_name: string | null; physical_address: string | null; vat_number: string | null; banking_details: any } | null;
  from: string;
  to: string;
  generated_at?: string;
  opening_balance: number;
  closing_balance: number;
  rows: StatementRow[];
  expires_at?: string;
}

export const TYPE_LABEL: Record<StatementRow["type"], string> = { invoice: "Invoice", payment: "Payment", credit_note: "Credit note" };

/** Default statement window: 12 months back to today (local dates, YYYY-MM-DD). */
export function defaultRange(today = new Date()): { from: string; to: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  return { from: iso(from), to: iso(today) };
}

/** Recomputes balances from the opening balance; used to double-check the server's running balance. */
export function runningBalances(opening: number, rows: Pick<StatementRow, "debit" | "credit">[]): number[] {
  let b = Number(opening) || 0;
  return rows.map((r) => (b = Math.round((b + (Number(r.debit) || 0) - (Number(r.credit) || 0)) * 100) / 100));
}

/** Total invoiced / received / credited in the period. */
export function statementTotals(st: Pick<Statement, "rows">) {
  const t = { invoiced: 0, paid: 0, credited: 0 };
  for (const r of st.rows) {
    if (r.type === "invoice") t.invoiced += Number(r.debit) || 0;
    else if (r.type === "payment") t.paid += Number(r.credit) || 0;
    else t.credited += Number(r.credit) || 0;
  }
  return t;
}

export const statementLinkUrl = (token: string, origin = typeof window !== "undefined" ? window.location.origin : "") => `${origin}/statement/${token}`;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function bankLines(b: any): string {
  if (!b || typeof b !== "object") return "";
  const parts = [b.bank_name || b.bank, b.account_name, b.account_number && `Acc ${b.account_number}`, b.branch_code && `Branch ${b.branch_code}`].filter(Boolean);
  return parts.length ? `<p class="muted">Banking: ${esc(parts.join(" · "))}</p>` : "";
}

/** Printable statement HTML (browser print → PDF). */
export function statementHtml(st: Statement): string {
  const body = st.rows
    .map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(TYPE_LABEL[r.type] || r.type)}</td><td>${esc(r.ref)}</td><td>${esc(r.description)}</td><td class="r">${r.debit ? formatRand(Number(r.debit)) : ""}</td><td class="r">${r.credit ? formatRand(Number(r.credit)) : ""}</td><td class="r">${formatRand(Number(r.balance))}</td></tr>`)
    .join("");
  const c = st.company || ({} as any);
  return `<!doctype html><html><head><title>Statement ${esc(st.customer?.name)}</title>
<style>body{font-family:system-ui,sans-serif;color:#1e293b;max-width:860px;margin:32px auto;padding:0 24px}h1{color:#1B3A5C;margin:0}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left}td.r,th.r{text-align:right}
.tot td{font-weight:700;border-top:2px solid #1B3A5C}.muted{color:#64748b;font-size:13px}.hdr{display:flex;justify-content:space-between;gap:24px}</style></head><body>
<div class="hdr"><div><h1>Statement</h1><p class="muted">${esc(st.from)} to ${esc(st.to)}</p>
<p><strong>${esc(st.customer?.name)}</strong>${st.customer?.company_name ? `<br/>${esc(st.customer.company_name)}` : ""}<br/>${esc(st.customer?.address)}</p></div>
<div style="text-align:right"><strong>${esc(c.company_name)}</strong><br/><span class="muted">${esc(c.physical_address)}${c.vat_number ? `<br/>VAT ${esc(c.vat_number)}` : ""}</span></div></div>
<table><tr><th>Date</th><th>Type</th><th>Ref</th><th>Details</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr>
<tr><td>${esc(st.from)}</td><td colspan="5">Opening balance</td><td class="r">${formatRand(Number(st.opening_balance))}</td></tr>
${body}
<tr class="tot"><td colspan="6">Balance due</td><td class="r">${formatRand(Number(st.closing_balance))}</td></tr></table>
${bankLines(c.banking_details)}
</body></html>`;
}

export function printStatement(st: Statement) {
  const w = window.open("", "_blank", "noopener=no,width=900,height=900");
  if (!w) return;
  w.document.write(statementHtml(st).replace("</body>", "<script>setTimeout(()=>window.print(),300)</script></body>"));
  w.document.close();
}
