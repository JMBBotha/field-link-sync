import { PO_ACCOUNTS_EMAIL, PO_DOCS_LINE, formatPoMoney, poIssuerName, type PoDraftView } from "@/lib/jobPurchaseOrder";
import "@/components/purchasing/purchaseOrder.css";
import "@/components/v8/roleHome/roleHome.css";

/** Review before send. Nothing is emailed until Send PO is pressed. */
export function PurchaseOrderPreview({
  companyName,
  drafts,
  emails,
  onEmails,
  onSend,
  onClose,
  sending,
  missingPrice = [],
  embedded = false,
}: {
  companyName: string;
  drafts: PoDraftView[];
  emails: Record<string, string>;
  onEmails: (poId: string, value: string) => void;
  onSend: () => void;
  onClose: () => void;
  sending?: boolean;
  missingPrice?: string[];
  embedded?: boolean;
}) {
  const name = poIssuerName(companyName);
  const ready = drafts.every((draft) => (emails[draft.id] || "").trim().length > 0);
  const panel = (
    <section className="po-sheet" data-testid="po-preview">
      <div className="po-bar" />
      <p className="po-kicker">Purchase order</p>
      <h2 data-testid="po-company">{name}</h2>
      <p className="po-sub">Check the supplier, the units and the total. Nothing is sent until you press Send PO.</p>
      {drafts.map((draft) => {
        const filled = (emails[draft.id] || "").trim().length > 0;
        return (
          <article key={draft.id} className="po-block" data-testid="po-draft">
            <div className="po-po">{draft.poNumber}</div>
            <div className="po-supplier" data-testid="po-supplier">{draft.supplierName}</div>
            {draft.clientName && <p className="po-meta">{draft.clientName}{draft.jobReference ? ` · ${draft.jobReference}` : ""}</p>}
            <label className="po-label" htmlFor={`po-email-${draft.id}`}>
              {filled ? "Supplier email" : "No email on file. Type one or more."}
            </label>
            <input
              id={`po-email-${draft.id}`}
              className="po-input"
              data-testid={filled ? "po-email-filled" : "po-email-manual"}
              value={emails[draft.id] || ""}
              placeholder="name@supplier.co.za"
              autoComplete="off"
              inputMode="email"
              onChange={(event) => onEmails(draft.id, event.target.value)}
            />
            <p className="po-cc" data-testid="po-cc">Copied on the email: {PO_ACCOUNTS_EMAIL}</p>
            <ul className="po-lines">
              {draft.lines.map((line) => (
                <li key={`${line.code}-${line.description}`}>
                  <span>{line.qty} × {line.code || line.description}</span>
                  <b>{formatPoMoney(line.lineTotal)}</b>
                </li>
              ))}
            </ul>
            <p className="po-total" data-testid="po-total">Total incl VAT {formatPoMoney(draft.total)}</p>
            <p className="po-docs" data-testid="po-docs">{PO_DOCS_LINE}</p>
          </article>
        );
      })}
      {missingPrice.length > 0 && (
        <p className="po-missing" data-testid="po-missing-price">No catalogue price, so left off this order: {missingPrice.join(", ")}.</p>
      )}
      <button type="button" className="rh-btn" data-testid="send-po" disabled={!ready || sending} onClick={onSend}>
        {sending ? "Sending…" : "Send PO"}
      </button>
      <button type="button" className="po-back" onClick={onClose}>Back</button>
    </section>
  );
  if (embedded) return panel;
  return (
    <div className="po-overlay" role="dialog" aria-modal="true" aria-label="Purchase order preview">
      {panel}
    </div>
  );
}
