import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isoDate } from "@/lib/cashflow";
import { prevPeriod, vatPeriodFor, type CashHealthData, type CfSettings, type Commitment, type Overhead, type Receipt, type StockItem } from "@/lib/cashHealth";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;
const must = <T,>(r: { data: T; error: any }) => { if (r.error) throw r.error; return r.data; };

/** Feature flag: cf_settings.enabled for the caller's company (RLS: owner/management only, so others always see "off"). */
export function useCashHealthEnabled() {
  const company = useQuery({ queryKey: ["caller-company-id"], queryFn: async () => ((await db.rpc("caller_company_id")).data as string | null) ?? null, staleTime: 300000 });
  const flag = useQuery({
    queryKey: ["cf-enabled", company.data], enabled: !!company.data, staleTime: 300000,
    queryFn: async () => !!((await db.from("cf_settings").select("enabled").eq("company_id", company.data).maybeSingle()).data?.enabled),
  });
  return { companyId: company.data ?? null, enabled: !!flag.data, loading: company.isLoading || flag.isLoading };
}

export type CashHealthActions = {
  saveBalance: (accountId: string, balance: number, asOf: string) => Promise<void>;
  addAccount: (label: string, ref: string) => Promise<void>;
  updateAccount: (id: string, patch: { label?: string; account_ref?: string | null; include?: boolean }) => Promise<void>;
  updateReceipt: (id: string, patch: Partial<Receipt>) => Promise<void>;
  addReceipt: (row: Partial<Receipt>) => Promise<void>;
  deleteReceipt: (id: string) => Promise<void>;
  updateCommitment: (id: string, patch: Partial<Commitment>) => Promise<void>;
  addCommitment: (row: Partial<Commitment>) => Promise<void>;
  deleteCommitment: (id: string) => Promise<void>;
  allocate: (commitmentId: string, stockItemId: string, qty: number) => Promise<void>;
  unallocate: (allocationId: string) => Promise<void>;
  stockTake: (rows: { id?: string; item: string; model_code?: string; qty: number; unit_cost_excl?: number; location?: string }[], clean: boolean) => Promise<void>;
  updateStock: (id: string, patch: Partial<StockItem>) => Promise<void>;
  saveOverhead: (row: Partial<Overhead>) => Promise<void>;
  deleteOverhead: (id: string) => Promise<void>;
  saveSettings: (patch: Partial<CfSettings>) => Promise<void>;
  resync: () => Promise<void>;
};

export function useCashHealth(companyId: string | null, enabled: boolean) {
  const qc = useQueryClient();
  const key = useMemo(() => ["cash-health", companyId], [companyId]);
  const synced = useRef(false);
  const q = useQuery({
    queryKey: key, enabled: !!companyId && enabled,
    queryFn: async (): Promise<CashHealthData> => {
      if (!synced.current) { synced.current = true; must(await db.rpc("cf_sync", { p_company: companyId })); }
      const eq = (t: string, sel = "*") => db.from(t).select(sel).eq("company_id", companyId);
      const settings = must(await eq("cf_settings").maybeSingle()) as CfSettings;
      const today = new Date();
      // Before go-live the forecast runs from forecast_start, so the VAT periods must too (else "previous" is the wrong period).
      const start = settings.forecast_start ? new Date(settings.forecast_start + "T00:00:00") : null;
      const cur = vatPeriodFor(settings, start && start > today ? start : today), prev = prevPeriod(settings, cur);
      const [receipts, commitments, stock, allocations, overheads, accounts, balances, invoices, vc, vp] = await Promise.all([
        eq("cf_receipts").order("expected_date", { ascending: true, nullsFirst: false }).order("ref").order("part"),
        eq("cf_commitments").order("project").order("created_at"),
        eq("cf_stock_items").eq("active", true).order("item"),
        eq("cf_stock_allocations"),
        eq("cf_overheads").order("sort").order("created_at"),
        eq("cf_bank_accounts").order("sort").order("created_at"),
        eq("cf_bank_balances").order("as_of", { ascending: false }).limit(200),
        eq("invoices", "id, invoice_number, status, issue_date, tax_amount, grand_total").neq("status", "void"),
        db.rpc("cf_vat_actuals", { p_company: companyId, p_from: cur.start, p_to: isoDate(today) }),
        db.rpc("cf_vat_actuals", { p_company: companyId, p_from: prev.start, p_to: prev.end }),
      ]);
      return {
        settings, receipts: must(receipts), commitments: must(commitments), stock: must(stock), allocations: must(allocations), overheads: must(overheads),
        accounts: must(accounts), balances: must(balances), invoices: must(invoices), vat: { current: must(vc), previous: must(vp) },
      };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const run = async (p: PromiseLike<{ error: any }>) => { const r = await p; if (r.error) throw r.error; await refresh(); };
  const actions: CashHealthActions = {
    saveBalance: (account_id, balance, as_of) => run(db.from("cf_bank_balances").insert({ company_id: companyId, account_id, balance, as_of })),
    addAccount: (label, account_ref) => run(db.from("cf_bank_accounts").insert({ company_id: companyId, label, account_ref, sort: 10 })),
    updateAccount: (id, patch) => run(db.from("cf_bank_accounts").update(patch).eq("id", id)),
    updateReceipt: (id, patch) => run(db.from("cf_receipts").update(patch).eq("id", id)),
    addReceipt: (row) => run(db.from("cf_receipts").insert({ ...row, company_id: companyId, source: "manual" })),
    deleteReceipt: (id) => run(db.from("cf_receipts").delete().eq("id", id).eq("source", "manual")),
    updateCommitment: (id, patch) => run(db.from("cf_commitments").update(patch).eq("id", id)),
    addCommitment: (row) => run(db.from("cf_commitments").insert({ ...row, company_id: companyId })),
    deleteCommitment: (id) => run(db.from("cf_commitments").delete().eq("id", id).is("source_key", null)),
    allocate: (p_commitment, p_stock_item, p_qty) => run(db.rpc("cf_allocate_stock", { p_commitment, p_stock_item, p_qty })),
    unallocate: (p_allocation) => run(db.rpc("cf_unallocate_stock", { p_allocation })),
    stockTake: (rows, clean) => run(db.rpc("cf_stock_take", { p_company: companyId, p_rows: rows, p_clean: clean })),
    updateStock: (id, patch) => run(db.from("cf_stock_items").update(patch).eq("id", id)),
    saveOverhead: ({ id, ...row }) => run(id ? db.from("cf_overheads").update(row).eq("id", id) : db.from("cf_overheads").insert({ ...row, company_id: companyId })),
    deleteOverhead: (id) => run(db.from("cf_overheads").delete().eq("id", id)),
    saveSettings: ({ enabled: _e, company_id: _c, ...patch }) => run(db.from("cf_settings").update(patch).eq("company_id", companyId)),
    resync: async () => { must(await db.rpc("cf_sync", { p_company: companyId })); await refresh(); },
  };
  useEffect(() => { synced.current = false; }, [companyId]);
  return { ...q, actions };
}
