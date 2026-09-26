import { describe, it, expect } from "vitest";
import { depositChipLabel } from "@/components/shared/DepositPaymentChip";

describe("depositChipLabel (map pin + staff chip wording)", () => {
  it("nothing paid → Deposit · total due", () => {
    expect(depositChipLabel({ id: "i", grand_total: 9774.6, amount_paid: 0 })).toBe("Deposit · R 9 774,60 due");
  });
  it("totals unknown → Deposit · total due", () => {
    expect(depositChipLabel({ id: "i", grand_total: 9774.6 })).toBe("Deposit · R 9 774,60 due");
  });
  it("partial → balance remaining due", () => {
    expect(depositChipLabel({ id: "i", grand_total: 9774.6, amount_paid: 2000 })).toBe("Partial · R 7 774,60 due");
  });
  it("paid in full unchanged", () => {
    expect(depositChipLabel({ id: "i", grand_total: 9774.6, amount_paid: 9774.6 })).toBe("Deposit paid");
  });
  it("no invoice", () => {
    expect(depositChipLabel(null, { accepted: true })).toBe("No deposit");
    expect(depositChipLabel(null)).toBeNull();
  });
});
// SQL behaviour (create_deposit_invoice_for_quote / notify_document_sent), not unit-testable here:
// - insert branch only: email present → status 'sent' → trg_invoices_sent_email fires once (WHEN old<>'sent').
// - existing invoice → early return, no status change, no email.
// - no email → email_events 'invoice_email_skipped_no_email' + notification 'deposit_invoice_not_emailed'.
// - every invoice send → email_events 'invoice_email_queued' with net_request_id and trigger accept_auto|status_sent.
