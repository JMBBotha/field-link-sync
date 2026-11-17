import { useState } from "react";
import { V8_DEMO_DEPOSIT_PERCENT, V8_QUOTE_OPTIONS, v8ApplyDiscount, v8PackList, v8QuoteTotals } from "@/lib/v8simple/quote";
import { v8Rand } from "@/lib/v8simple/jobs";
import { usePreviewRole } from "./V8SimpleShell";

/** Tablet-first quote. One discount, at most 15%. Send is the only orange button. */
export function V8SimpleQuote() {
  const role = usePreviewRole();
  const [optionId, setOptionId] = useState(V8_QUOTE_OPTIONS[0].id);
  const [discount, setDiscount] = useState<number | null>(null);
  const [draft, setDraft] = useState("10");
  const [reason, setReason] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (role === "tech") {
    return (
      <section className="rh-card" data-testid="v8-quote-tech">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h1 className="v8s-h1">Quote</h1>
          <p className="rh-muted">Quotes stay with sales. This screen has no prices for a technician.</p>
        </div>
      </section>
    );
  }
  const option = V8_QUOTE_OPTIONS.find((item) => item.id === optionId) || V8_QUOTE_OPTIONS[0];
  const totals = v8QuoteTotals(option.lines, discount || 0, V8_DEMO_DEPOSIT_PERCENT);
  const pack = v8PackList(option.lines);
  const apply = () => {
    const next = v8ApplyDiscount(discount, Number(draft));
    if (!next.ok) setReason(next.reason);
    else { setDiscount(next.percent); setReason(null); }
  };
  return (
    <div className="v8s-quote" data-testid="v8-quote">
      <section className="rh-card">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <p className="rh-eyebrow">Price list · demo</p>
          <h1 className="v8s-h1">Quote</h1>
          <div className="v8s-options" role="radiogroup" aria-label="Option">
            {V8_QUOTE_OPTIONS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={item.id === optionId} className={item.id === optionId ? "is-on" : ""} onClick={() => setOptionId(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <ul className="v8s-lines">
            {option.lines.map((line) => (
              <li key={line.name}><span>{line.name}</span><span>{line.qty} · {v8Rand(line.amount)}</span></li>
            ))}
          </ul>
        </div>
      </section>
      <section className="rh-card">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h2>One discount</h2>
          <p className="rh-muted">At most 15%. It does not stack.</p>
          <div className="v8s-discount">
            <input aria-label="Discount percent" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button type="button" onClick={apply}>Apply</button>
          </div>
          {reason && <p data-testid="v8-discount-reason">{reason}</p>}
          <p data-testid="v8-quote-totals">Total {v8Rand(totals.total)} · Deposit {V8_DEMO_DEPOSIT_PERCENT}% · {v8Rand(totals.deposit)}</p>
          <h2>Pack list</h2>
          <ul data-testid="v8-pack-list">
            {pack.map((line) => <li key={line.name}>{line.qty} × {line.name}</li>)}
          </ul>
          <button type="button" className="v8s-next" data-orange="main" data-testid="v8-send-quote" onClick={() => setSent(true)}>Send quote</button>
          {sent && <p data-testid="v8-send-note">Preview only. The quote was not sent.</p>}
        </div>
      </section>
    </div>
  );
}
