import { describe, it, expect } from "vitest";
import { v8ColOf, v8Drop } from "@/lib/v8Flow";
const deal = (stage: any, value = 1000, paid = 0) => ({ quote: { id: "q1" }, stage, value, paid } as any);
describe("v8 Lead → Paid board", () => {
  it("derives Invoiced and Paid only from existing invoices/payments", () => {
    expect(v8ColOf(deal("sent"), [])).toBe("quote");
    expect(v8ColOf(deal("booked"), [])).toBe("booked");
    expect(v8ColOf(deal("booked"), [{ quote_id: "q1", status: "sent" } as any])).toBe("invoiced");
    expect(v8ColOf(deal("booked"), [{ quote_id: "q1", status: "void" } as any])).toBe("booked");
    expect(v8ColOf(deal("booked", 1000, 1000), [])).toBe("paid");
  });
  it("uses only the existing transitions", () => {
    expect(v8Drop(deal("draft"), "quote").action).toBe("send");
    expect(v8Drop(deal("viewed"), "accepted").action).toBe("accept");
    expect(v8Drop(deal("accepted"), "booked").action).toBe("book");
    expect(v8Drop(deal("sent"), "lost").action).toBe("lose");
    expect(v8Drop(deal("booked"), "paid").action).toBe(null);
    expect(v8Drop(deal("booked"), "invoiced").action).toBe(null);
    expect(v8Drop(deal("sent"), "booked").action).toBe(null);
  });
});
