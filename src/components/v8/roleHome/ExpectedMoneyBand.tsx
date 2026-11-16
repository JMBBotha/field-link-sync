import { useState } from "react";
import { Link } from "react-router-dom";
import type { ExpectedKind, ExpectedPicture, ExpectedRow } from "@/lib/expectedMoney";

export interface ExpectedDraft {
  kind: ExpectedKind;
  amount: string;
  date: string;
  client: string;
  invoiceId: string;
  note: string;
}

export interface InvoiceChoice {
  id: string;
  label: string;
}

const EMPTY: ExpectedDraft = { kind: "deposit", amount: "", date: "", client: "", invoiceId: "", note: "" };

/** Cash on hand, the next 7 days, the next 30 days, and the projected total. The projected figure is the one that should be seen first. */
export function ExpectedMoneyBand({
  picture,
  invoices = [],
  startOpen = false,
  onAdd,
  onStatus,
}: {
  picture: ExpectedPicture;
  invoices?: InvoiceChoice[];
  startOpen?: boolean;
  onAdd?: (draft: ExpectedDraft) => Promise<void>;
  onStatus?: (id: string, status: "received" | "cancelled") => Promise<void>;
}) {
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState<ExpectedDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!onAdd) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(draft);
      setDraft(EMPTY);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function mark(row: ExpectedRow, status: "received" | "cancelled") {
    if (!onStatus) return;
    setError(null);
    try {
      await onStatus(row.id, status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that.");
    }
  }

  return (
    <div className="money-hero-wrap" data-testid="expected-money">
      <div className="money-hero">
        <Hero k="Cash on hand" amt={picture.cashLabel} sub="In the bank" testId="hero-cash" />
        <Hero k="Next 7 days" amt={picture.next7Label} sub="Includes overdue" testId="hero-7" />
        <Hero k="Next 30 days" amt={picture.next30Label} sub="Includes overdue" testId="hero-30" />
        <Hero k="Projected" amt={picture.projectedLabel} sub={picture.projected == null ? "Enter the bank balance" : "Cash + 30 days"} testId="hero-projected" projected />
      </div>
      <div className="money-hero-actions">
        <button type="button" className="money-add" data-testid="expected-add" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Add expected money"}
        </button>
      </div>
      {open && (
        <div className="money-list" data-testid="expected-list">
          <form className="money-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label>Kind
              <select aria-label="Kind" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ExpectedKind })}>
                <option value="deposit">Expected deposit</option>
                <option value="final">Expected final</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Amount
              <input aria-label="Amount" inputMode="decimal" value={draft.amount} placeholder="0" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
            </label>
            <label>Expected date
              <input aria-label="Expected date" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
            </label>
            <label>Client
              <input aria-label="Client" value={draft.client} placeholder="Optional" onChange={(event) => setDraft({ ...draft, client: event.target.value })} />
            </label>
            <label>Invoice
              <select aria-label="Invoice" value={draft.invoiceId} onChange={(event) => setDraft({ ...draft, invoiceId: event.target.value })}>
                <option value="">None</option>
                {invoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.label}</option>)}
              </select>
            </label>
            <label>Note
              <input aria-label="Note" value={draft.note} placeholder="Optional" onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
            </label>
            <button type="submit" className="money-add" data-testid="expected-save" disabled={busy || !onAdd}>Save</button>
          </form>
          {error && <p className="money-error" data-testid="expected-error">{error}</p>}
          <ul className="yard-lines">
            {picture.rows.map((row) => (
              <li key={row.id} data-testid={`expected-row-${row.id}`} data-late={row.late ? "1" : "0"}>
                <div className="money-row">
                  {row.href ? <Link to={row.href}>{row.label}</Link> : <span>{row.label}</span>}
                  <span className="yard-line-meta">{row.dateLabel}</span>
                  <b>{row.amountLabel}</b>
                  {row.tap && onStatus && (
                    <span className="money-taps">
                      <button type="button" data-testid={`expected-received-${row.id}`} onClick={() => void mark(row, "received")}>Received</button>
                      <button type="button" data-testid={`expected-cancel-${row.id}`} onClick={() => void mark(row, "cancelled")}>Cancel</button>
                    </span>
                  )}
                </div>
              </li>
            ))}
            {picture.rows.length === 0 && <li className="rh-muted">Nothing expected. Open invoices show here on their own.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function Hero({ k, amt, sub, testId, projected }: { k: string; amt: string; sub: string; testId: string; projected?: boolean }) {
  return (
    <div className={projected ? "money-cell money-cell-projected" : "money-cell"} data-testid={testId}>
      <span className="yard-k">{k}</span>
      <span className="yard-amt">{amt}</span>
      <span className="yard-when">{sub}</span>
    </div>
  );
}
