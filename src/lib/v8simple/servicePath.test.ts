import { describe, it, expect } from "vitest";
import { v8RepairDeposit, v8ServiceInvoice } from "@/lib/v8simple/servicePath";

describe("service call-out", () => {
  it("charges R680 excl. VAT per tech visit on its own line and leaves sales visits free", () => {
    const invoice = v8ServiceInvoice([{ kind: "sales" }, { kind: "tech" }, { kind: "tech" }], 240);
    expect(invoice.callOutExclVat).toBe(1360);
    expect(invoice.salesVisitsFree).toBe(1);
    expect(invoice.deducted).toBe(false);
    expect(invoice.lines[0]).toMatchObject({ name: "Call-out", exclVat: 1360, ownLine: true });
    expect(invoice.lines[1].exclVat).toBe(240);
    const repair = v8RepairDeposit(4000);
    expect(repair.percent).toBe(70);
    expect(repair.amount).toBe(2800);
  });
});
