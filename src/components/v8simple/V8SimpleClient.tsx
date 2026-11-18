import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { V8_DEMO_ESTATE_PAYER, v8ClientButton, v8DepositAmount, v8EftInstructions, v8YocoSandbox, type V8ClientQuote } from "@/lib/v8simple/clientPay";
import { v8BalanceOnJobDone, v8PayBalance } from "@/lib/v8simple/balance";
import { v8Rand } from "@/lib/v8simple/jobs";

const DEMO: V8ClientQuote = {
  quoteNo: "Q-1048",
  kind: "install",
  total: 14000,
  depositPercent: 70,
};

export function V8SimpleClientPage() {
  const [sp] = useSearchParams();
  const kind = sp.get("kind");
  if (sp.get("pay") === "balance") return <V8SimpleBalance />;
  if (kind === "repair") return <V8SimpleClient quote={{ quoteNo: "Q-R1", kind: "repair", total: 4000, depositPercent: 70 }} />;
  if (kind === "developer") return <V8SimpleClient quote={{ quoteNo: "Q-H12", kind: "developer", total: 18000, depositPercent: 70 }} />;
  return <V8SimpleClient />;
}
export function V8SimpleClient({ quote = DEMO }: { quote?: V8ClientQuote }) {
  const [accepted, setAccepted] = useState(!!quote.accepted);
  const [paid, setPaid] = useState(!!quote.depositPaid);
  const [eft, setEft] = useState(!!quote.eftWaiting);
  const [proof, setProof] = useState<string | null>(null);
  const deposit = v8DepositAmount(quote.total, quote.depositPercent);
  const view: V8ClientQuote = { ...quote, accepted, depositPaid: paid, eftWaiting: eft && !paid };
  const button = v8ClientButton(view);
  const bank = v8EftInstructions(quote.quoteNo);
  const house = quote.kind === "developer";
  return (
    <article className="v8s-client" data-testid="v8-client-page" data-kind={quote.kind}>
      <header className="v8s-bar"><span>Field Lynk</span><small>Demo Company</small></header>
      <div className="v8s-client-body">
        <p className="rh-eyebrow">{house ? "Demo Estate · House 12" : quote.kind === "repair" ? "Repair quote" : "Quote"} {quote.quoteNo}</p>
        {house && <p data-testid="v8-payer">Pay link for {V8_DEMO_ESTATE_PAYER.name}. This is the project payer, not the person in the house.</p>}
        <h1 className="v8s-h1">{button}</h1>
        <p className="rh-muted">Total {v8Rand(quote.total)}. Deposit {quote.depositPercent ?? 70}% is {v8Rand(deposit)}.</p>
        {!accepted && !paid && (
          <button type="button" className="v8s-next" data-orange="main" data-testid="v8-accept-pay" onClick={() => setAccepted(true)}>
            Accept &amp; pay deposit
          </button>
        )}
        {accepted && !paid && (
          <div data-testid="v8-pay-choices">
            <button
              type="button"
              className="v8s-next"
              data-orange="main"
              data-testid="v8-yoco"
              onClick={() => {
                const result = v8YocoSandbox({ status: "succeeded", amount: deposit, quoteNo: quote.quoteNo });
                setPaid(result.depositPaid);
              }}
            >
              Pay with Yoco
            </button>
            <button type="button" className="v8s-ghost" data-testid="v8-eft" onClick={() => setEft(true)}>Pay by EFT</button>
            {eft && (
              <section data-testid="v8-eft-block">
                <p>Waiting for EFT. Pay {v8Rand(deposit)} to {bank.accountName}.</p>
                <p>{bank.bank} · {bank.accountNumber} · branch {bank.branch}</p>
                <p>Reference {bank.reference}</p>
                <label className="v8s-ghost">
                  Upload proof
                  <input type="file" data-testid="v8-proof" onChange={(event) => setProof(event.target.files?.[0]?.name || "proof")} />
                </label>
                {proof && <p data-testid="v8-proof-name">{proof} saved on this phone only.</p>}
              </section>
            )}
          </div>
        )}
        {paid && <p data-testid="v8-deposit-paid">Deposit paid in the Yoco sandbox. Nothing was charged.</p>}
      </div>
    </article>
  );
}

export function V8SimpleBalance() {
  const built = v8BalanceOnJobDone({ quoteNo: "Q-1088", quoteTotal: 20000, deposit: 14000, callOutExclVat: 680, doneOn: "2026-11-17" });
  const [paid, setPaid] = useState(false);
  const invoice = paid ? v8PayBalance(built, "yoco") : built;
  return (
    <article className="v8s-client" data-testid="v8-balance-page">
      <header className="v8s-bar"><span>Field Lynk</span><small>Demo Company</small></header>
      <div className="v8s-client-body">
        <p className="rh-eyebrow">Balance · {invoice.quoteNo}</p>
        <h1 className="v8s-h1">{invoice.status === "paid" ? "Paid" : "Pay balance"}</h1>
        <p>Due {invoice.dueOn}. {v8Rand(invoice.total)}.</p>
        <p className="rh-muted">Call-out R680 excl. VAT is its own line and is not deducted.</p>
        {invoice.status !== "paid" && (
          <>
            <button type="button" className="v8s-next" data-orange="main" data-testid="v8-pay-balance" onClick={() => setPaid(true)}>Pay balance with Yoco</button>
            <p className="rh-muted">Or EFT, reference {invoice.quoteNo}.</p>
          </>
        )}
        {invoice.status === "paid" && <p data-testid="v8-balance-closed">Paid. This job is closed.</p>}
      </div>
    </article>
  );
}
