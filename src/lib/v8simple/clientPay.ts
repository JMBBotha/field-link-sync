/**
 * Client pay page (S9). Yoco is sandbox only here. EFT shows the quote number as the reference.
 * Repair quotes take the same deposit percent. Developer houses use this page too.
 */
import { V8_DEMO_DEPOSIT_PERCENT } from "@/lib/v8simple/quote";

export const V8_CLIENT_DEPOSIT_PERCENT = V8_DEMO_DEPOSIT_PERCENT;

export interface V8ClientQuote {
  quoteNo: string;
  kind: "install" | "repair" | "developer";
  total: number;
  depositPercent?: number;
  accepted?: boolean;
  depositPaid?: boolean;
  eftWaiting?: boolean;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Developer houses and repair quotes both get the client pay page. */
export function v8ClientPayPage(quote: Pick<V8ClientQuote, "kind">): boolean {
  return quote.kind === "install" || quote.kind === "repair" || quote.kind === "developer";
}

export function v8DepositAmount(total: number, percent = V8_CLIENT_DEPOSIT_PERCENT): number {
  return round2((Number(total) || 0) * (Number(percent) || 0) / 100);
}

export function v8ClientButton(quote: V8ClientQuote): "Accept & pay deposit" | "Waiting for EFT" | "Deposit paid" {
  if (quote.depositPaid) return "Deposit paid";
  if (quote.eftWaiting) return "Waiting for EFT";
  return "Accept & pay deposit";
}

/** Sandbox stand-in for yoco-webhook. A succeeded payment marks the deposit paid. Nothing is charged. */
export function v8YocoSandbox(event: { status: "succeeded" | "failed"; amount: number; quoteNo: string }): {
  depositPaid: boolean;
  gateway: "yoco";
  environment: "sandbox";
  quoteNo: string;
  amount: number;
} {
  return {
    depositPaid: event.status === "succeeded" && event.amount > 0,
    gateway: "yoco",
    environment: "sandbox",
    quoteNo: event.quoteNo,
    amount: round2(event.amount),
  };
}

export function v8EftInstructions(quoteNo: string) {
  return {
    bank: "FNB",
    accountName: "Demo Company",
    accountNumber: "62000000000",
    branch: "250655",
    reference: quoteNo,
    status: "waiting for EFT" as const,
  };
}
