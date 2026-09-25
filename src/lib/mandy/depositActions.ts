/**
 * Deposit actions for Mandy. Pure factories (deps injected) so the confirm
 * rule is unit-testable: create_deposit_invoice NEVER calls
 * ensureDepositInvoiceForQuote until the on-screen confirm.run() is tapped.
 * No new maths — state/remaining come from DepositPaymentChip helpers, the
 * amount is the RPC's own rule (quote total × company deposit %).
 */
import type { MandyResult } from "./actions";
import { fmtRand } from "./actions";
import type { DepositInvoiceRow } from "@/lib/depositInvoice";
import { getDepositChipState, getDepositRemaining } from "@/components/shared/DepositPaymentChip";

export interface DepositQuote {
  id: string;
  quote_number: string | null;
  status: string | null;
  total: number | null;
  customer_name?: string | null;
}

export interface DepositDeps {
  resolveQuote: (quoteRef?: string) => Promise<DepositQuote | { choices: { label: string; quote_ref: string }[] } | null>;
  fetchInvoice: (quoteId: string) => Promise<DepositInvoiceRow | null>;
  depositPercent: () => Promise<number>;
  ensureDeposit: (quoteId: string) => Promise<string>;
  onCreated?: (quoteId: string, invoiceId: string) => void;
}

const isAccepted = (q: DepositQuote) => String(q.status || "").toLowerCase() === "accepted";

async function pick(deps: DepositDeps, action: string, quote_ref?: string): Promise<DepositQuote | MandyResult> {
  const q = await deps.resolveQuote(quote_ref);
  if (!q) return { ok: false, message: quote_ref ? `No quote matching “${quote_ref}”.` : "No quote is open — say which quote." };
  if ("choices" in q) {
    return { ok: true, message: "Several quotes match. Waiting for the user to tap one.", choices: q.choices.map((c) => ({ label: c.label, action, args: { quote_ref: c.quote_ref } })) };
  }
  return q;
}

export function makeDepositHandlers(deps: DepositDeps) {
  return {
    show_deposit_due: async ({ quote_ref }: Record<string, any>): Promise<MandyResult> => {
      const q = await pick(deps, "show_deposit_due", quote_ref);
      if ("ok" in q) return q;
      const ref = q.quote_number || "this quote";
      if (!isAccepted(q)) return { ok: true, message: `${ref} is not accepted yet, so no deposit is due.` };
      const inv = await deps.fetchInvoice(q.id);
      const state = getDepositChipState(inv, { accepted: true });
      if (state === "none" || !inv) return { ok: true, message: `${ref} has no deposit invoice yet.`, data: { state } };
      const rem = getDepositRemaining(inv);
      const total = Number(inv.grand_total) || 0;
      const msg =
        state === "paid" ? `Deposit paid on ${ref} (${fmtRand(total)}).`
        : state === "partial" ? `Deposit part-paid on ${ref}: ${fmtRand(rem ?? 0)} still due of ${fmtRand(total)}.`
        : `Deposit due on ${ref}: ${fmtRand(rem ?? total)} incl. VAT.`;
      return { ok: true, message: msg, data: { state, invoice_id: inv.id, remaining: rem ?? null, total } };
    },

    create_deposit_invoice: async ({ quote_ref }: Record<string, any>): Promise<MandyResult> => {
      const q = await pick(deps, "create_deposit_invoice", quote_ref);
      if ("ok" in q) return q;
      const ref = q.quote_number || "this quote";
      if (!isAccepted(q)) return { ok: false, message: `${ref} is not accepted, so no deposit invoice was created.` };
      const existing = await deps.fetchInvoice(q.id);
      if (existing?.id) return { ok: false, message: `${ref} already has a deposit invoice — nothing created.` };
      const pct = await deps.depositPercent();
      const amount = (Number(q.total) || 0) * (pct / 100);
      return {
        ok: true,
        message: `Awaiting on-screen confirmation to create the deposit invoice for ${ref}.`,
        confirm: {
          summary: `Create deposit invoice of ${fmtRand(amount)} for ${ref}?`,
          run: async () => {
            try {
              const id = await deps.ensureDeposit(q.id);
              deps.onCreated?.(q.id, id);
              return { ok: true, message: `Created the ${pct}% deposit invoice for ${ref}: ${fmtRand(amount)} incl. VAT.`, data: { invoice_id: id } };
            } catch (e: any) {
              return { ok: false, message: `Could not create the deposit invoice: ${e?.message || e}` };
            }
          },
        },
      };
    },
  };
}
