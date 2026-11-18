import { describe, it, expect } from "vitest";
import { CsvPdfImportSource, v8AutoMatchEft, v8CanUndoEft, v8MarkEftReceived, type V8BankLine, type V8EftExpect } from "@/lib/v8simple/eftMatch";
import { v8Stage } from "@/lib/v8simple/stage";

const expectDeposit: V8EftExpect = { id: "dep-1", quoteNo: "Q-1048", invoiceNo: "DEMO-D1", amount: 9800, client: "Demo client D" };
const imported = (line: Omit<V8BankLine, "origin">): V8BankLine => ({ ...line, origin: "csv_pdf_import" });

describe("EFT received fallback", () => {
  it("records a manual fallback with amount, date and who, and undoes it the same day", () => {
    const marked = v8MarkEftReceived(expectDeposit, { amount: 9800, date: "2026-11-18", who: "Demo admin" });
    expect(marked).toMatchObject({ via: "manual", amount: 9800, date: "2026-11-18", who: "Demo admin" });
    expect(v8CanUndoEft("2026-11-18", "2026-11-18")).toBe(true);
    expect(v8CanUndoEft("2026-11-18", "2026-11-19")).toBe(false);
    expect("error" in v8MarkEftReceived(expectDeposit, { amount: 1, date: "2026-11-18", who: "Demo admin" })).toBe(true);
  });
});

describe("imported statement match", () => {
  it("matches through CsvPdfImportSource and ignores anything that is not an imported line", () => {
    const lines: V8BankLine[] = [
      imported({ id: "ok", amount: 9800, reference: "Q-1048", description: "statement row", txnDate: "2026-11-17", status: "new" }),
      imported({ id: "wrong-amount", amount: 1000, reference: "Q-1048", description: "", txnDate: "2026-11-17", status: "new" }),
      imported({ id: "amount-only", amount: 9800, reference: "THANKS", description: "payment", txnDate: "2026-11-17", status: "new" }),
      { id: "feed", amount: 9800, reference: "Q-1048", description: "not imported", txnDate: "2026-11-17", status: "new", origin: "future_feed" },
    ];
    const source = new CsvPdfImportSource(lines);
    expect(source.kind).toBe("csv_pdf_import");
    expect(source.lines().map((line) => line.id)).toEqual(["ok", "wrong-amount", "amount-only"]);
    const result = v8AutoMatchEft(source, [expectDeposit]);
    expect(result.matched.map((row) => row.lineId)).toEqual(["ok"]);
    expect(result.unmatched.map((row) => row.id)).toEqual(["wrong-amount", "amount-only"]);
    expect(source.lines().some((line) => line.id === "feed")).toBe(false);
    const after = v8Stage({ quoteStatus: "accepted", depositPaid: true, depositRemaining: 0, techId: null });
    expect(after.label).toBe("Ready to book");
  });
});
