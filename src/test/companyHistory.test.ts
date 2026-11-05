import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { historyTable, historyTotals, isCollectibleInvoice, type HistoryInvoice } from "@/lib/companyHistory";

const IND = "7b0a1ac1-de4c-57c2-9274-49afe4344719";
const row = (over: Partial<HistoryInvoice>): HistoryInvoice => ({
  id: "i", invoice_number: "0001", customer_name: "Client", customer_id: "c", status: "sent",
  grand_total: 100, issue_date: "2026-01-01", due_date: null, archived_at: null, customer_status: "active", paid: 0, ...over,
});

describe("archived company history", () => {
  it("reads the import tables only when the company is archived", () => {
    expect(historyTable("invoices", true)).toBe("invoices");
    expect(historyTable("estimates", true)).toBe("quotes");
    expect(historyTable("clients", true)).toBe("customers");
    expect(historyTable("payments", true)).toBe("payments");
    expect(historyTable("invoices", false)).toBe("company_invoices");
    const list = readFileSync("src/components/freshbooks/FBInvoiceList.tsx", "utf8");
    expect(list).toContain('company?.status === "archived"');
    expect(list).toContain("CompanyHistoryInvoices");
    expect(readFileSync("src/pages/FBCreateInvoicePage.tsx", "utf8")).toContain('company?.status === "archived"');
    expect(readFileSync("src/components/company/ClientShellAudit.tsx", "utf8")).toContain('company?.status === "archived"');
    expect(readFileSync("src/App.tsx", "utf8")).toContain("<ClientShellAudit />");
    const sql = readFileSync("supabase/migrations/20261105235000_company_history_reader.sql", "utf8");
    expect(sql).toMatch(/WHERE i\.company_id = p_company/);
    expect(sql).toContain("p4_co_ok(p_company)");
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("keeps archived invoices and archived clients out of collectible AR", () => {
    const rows = [
      row({ id: "open", grand_total: 200, paid: 50 }),
      row({ id: "archived-inv", archived_at: "2026-01-01", grand_total: 80, paid: 0 }),
      row({ id: "pge", customer_status: "archived", grand_total: 40, paid: 0, customer_name: "PGE Construction" }),
      row({ id: "paid", status: "paid", grand_total: 10, paid: 10 }),
    ];
    expect(rows.filter(isCollectibleInvoice).map((r) => r.id)).toEqual(["open"]);
    expect(historyTotals(rows)).toEqual({ count: 4, collectible: 150, paid: 60, history: 330 });
    expect(rows.every((r) => r.id !== IND)).toBe(true);
  });
});
