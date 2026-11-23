import { readFileSync } from "fs";
import { describe, expect, it, vi } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";
import type { MaterialCheck, MaterialLine } from "@/lib/materialCheck";
import {
  assembleWeekStock,
  emailsOnFile,
  isOrderableUnit,
  formatPoDate,
  parseEmailList,
  planJobPurchaseOrders,
  poIssuerName,
  poRecipients,
  poTextHasBanned,
  poTotals,
  purchaseOrderEmailHtml,
  supplierEmailsToSave,
  unitLinesFromSources,
  type LinkedPo,
  type OrderCandidate,
  type WeekStockJob,
} from "@/lib/jobPurchaseOrder";
import { PurchaseOrderPreview } from "@/components/purchasing/PurchaseOrderPreview";
import { StockOrdersCard } from "@/components/purchasing/StockOrdersCard";

const OTHER = "11111111-1111-4111-8111-111111111111";

function line(id: string, label: string, unit: MaterialLine["unit"] = "each", needed = 1): MaterialLine {
  return { id, label, href: null, status: "to_pick", shortQty: needed, needed, onHand: 0, stockId: null, unit };
}

function check(lines: MaterialLine[]): MaterialCheck {
  return { kind: "installation", show: true, lines, toPickCount: lines.length };
}

function job(extra: Partial<WeekStockJob> = {}): WeekStockJob {
  return {
    jobId: "job-1",
    href: "/admin/jobs/job-1",
    companyId: MASSAIR_CT_ID,
    client: "Mark Le Grange",
    title: "Install",
    scheduledFor: "2026-11-26T08:00:00+02:00",
    kind: "installation",
    check: check([line("qi-36", "INVEXT-36"), line("qi-24", "INVEXT-24-R32"), line("cu", "Copper pipe", "m", 6)]),
    unitLines: [
      { key: "qi-36", productId: "p36", label: "INVEXT-36", status: "to_pick", shortQty: 1 },
      { key: "qi-24", productId: "p24", label: "INVEXT-24-R32", status: "to_pick", shortQty: 1 },
    ],
    ...extra,
  };
}

function po(partial: Partial<LinkedPo> & Pick<LinkedPo, "status" | "lines">): LinkedPo {
  return {
    id: "po-1",
    jobId: "job-1",
    companyId: MASSAIR_CT_ID,
    poNumber: "PO-MLG-01",
    sentAt: null,
    createdAt: "2026-11-23T08:00:00+02:00",
    ...partial,
  };
}

function view(pos: LinkedPo[] = [], extra?: Partial<WeekStockJob>) {
  return assembleWeekStock(MASSAIR_CT_ID, [job(extra)], pos);
}

describe("stock orders treat a linked purchase order as covered", () => {
  it("counts both units as shortages while nothing is ordered", () => {
    const week = view();
    expect(week.nagCount).toBe(3);
    expect(week.unitRows[0].title).toBe("Mark Le Grange");
    expect(week.unitRows[0].lines.map((line) => line.state)).toEqual(["needs", "needs"]);
    expect(week.orders.map((order) => order.label)).toEqual(["6 m × Copper pipe"]);
    expect(week.orders.some((order) => /INVEXT/.test(order.label))).toBe(false);
  });

  it("shows PO raised for a draft and stops counting that line", () => {
    const week = view([po({ status: "draft", lines: [{ quoteItemId: "qi-36", productId: "p36" }] })]);
    const raised = week.unitRows[0].lines.find((line) => line.key === "qi-36");
    const open = week.unitRows[0].lines.find((line) => line.key === "qi-24");
    expect(raised).toMatchObject({ state: "raised", poNumber: "PO-MLG-01" });
    expect(open?.state).toBe("needs");
    expect(week.nagCount).toBe(2);
    expect(week.levels.some((level) => level.name === "INVEXT-36")).toBe(false);
    expect(week.levels.some((level) => level.name === "INVEXT-24-R32")).toBe(true);
  });

  it("shows Ordered with the PO number and date once the order is sent", () => {
    const sentAt = "2026-11-23T10:00:00+02:00";
    const week = view([po({
      status: "sent",
      sentAt,
      lines: [{ quoteItemId: "qi-36" }, { productId: "p24" }],
    })]);
    expect(week.nagCount).toBe(1);
    expect(week.unitRows[0].lines.every((line) => line.state === "ordered")).toBe(true);
    expect(week.unitRows[0].lines[0].dateLabel).toBe(formatPoDate(sentAt));
    expect(week.unitRows[0].lines[0].poNumber).toBe("PO-MLG-01");
    expect(week.levels.some((level) => /INVEXT/.test(level.name))).toBe(false);
  });

  it("lets a sent order win when a draft also exists for the same line", () => {
    const week = view([
      po({ id: "draft", status: "draft", poNumber: "PO-DRAFT", lines: [{ quoteItemId: "qi-36" }] }),
      po({ id: "sent", status: "ordered", poNumber: "PO-SENT", sentAt: "2026-11-23T10:00:00+02:00", lines: [{ quoteItemId: "qi-36" }] }),
    ]);
    expect(week.unitRows[0].lines.find((line) => line.key === "qi-36")).toMatchObject({ state: "ordered", poNumber: "PO-SENT" });
  });

  it("does not cover a line from another job, another company, or a cancelled order", () => {
    const week = view([
      po({ id: "other-job", jobId: "job-2", status: "sent", lines: [{ quoteItemId: "qi-36" }] }),
      po({ id: "other-co", companyId: OTHER, status: "draft", lines: [{ quoteItemId: "qi-24" }] }),
      po({ id: "cancelled", status: "cancelled", lines: [{ quoteItemId: "qi-36" }, { quoteItemId: "qi-24" }] }),
    ]);
    expect(week.unitRows[0].lines.every((line) => line.state === "needs")).toBe(true);
    expect(week.nagCount).toBe(3);
  });

  it("shows Create for a Midea model that is not typed as an indoor unit", () => {
    const material = check([
      line("pack-24", "Midea 24K (INVEXT-24-R32) · 1"),
      line("pack-36", "Midea 36K (INVEXT-36) · 1"),
    ]);
    const units = unitLinesFromSources(material, [
      { id: "qi-24", name: "Midea 24K (INVEXT-24-R32)", productId: "p24", productType: null, code: "INVEXT-24-R32" },
      { id: "qi-36", name: "Midea 36K (INVEXT-36)", productId: "p36", productType: null, code: "INVEXT-36" },
    ]);
    const week = assembleWeekStock(MASSAIR_CT_ID, [job({
      check: material,
      unitLines: units.unitLines,
      productByLine: units.productByLine,
    })], []);
    expect(week.orders).toEqual([]);
    expect(week.nagCount).toBe(2);
    expect(week.unitRows[0].lines.map((item) => item.label)).toEqual([
      "Midea 24K (INVEXT-24-R32)",
      "Midea 36K (INVEXT-36)",
    ]);
    expect(week.unitRows[0].lines.every((item) => item.state === "needs")).toBe(true);
    expect(isOrderableUnit({ name: "Copper pipe 15m" })).toBe(false);
    expect(isOrderableUnit({ name: "R32 gas" })).toBe(false);
  });

  it("matches an install unit by catalogue type and covers it by quote item or product", () => {
    const material = check([line("pack-0-INVEXT-36", "INVEXT-36")]);
    const units = unitLinesFromSources(material, [{
      id: "qi-36", name: "Midea INVEXT-36", productId: "p36", productType: "ac_unit", code: "INVEXT-36",
    }]);
    expect(units.unitLines[0]).toMatchObject({ key: "qi-36", checkLineId: "pack-0-INVEXT-36", productId: "p36" });
    const week = assembleWeekStock(MASSAIR_CT_ID, [{
      ...job({ check: material, unitLines: units.unitLines, productByLine: units.productByLine }),
    }], [po({ status: "draft", lines: [{ productId: "p36" }] })]);
    expect(week.unitRows[0].lines[0].state).toBe("raised");
    expect(week.nagCount).toBe(0);
    expect(week.orders).toEqual([]);
  });
});

describe("a job purchase order uses catalogue cost and one draft per supplier", () => {
  const midea = (over: Partial<OrderCandidate>): OrderCandidate => ({
    quoteItemId: "qi-36",
    productId: "p36",
    supplierId: "livance",
    supplierName: "MIDEA - LIVANCE",
    code: "INVEXT-36",
    description: "INVEXT-36",
    quotedQty: 1,
    onHand: 0,
    alreadyOnPo: false,
    unitCostExcl: 20342.11,
    isUnit: true,
    ...over,
  });

  it("prices the short quantity from the catalogue and adds 15% VAT", () => {
    const planned = planJobPurchaseOrders([
      midea({}),
      midea({ quoteItemId: "qi-24", productId: "p24", code: "INVEXT-24-R32", description: "INVEXT-24-R32", unitCostExcl: 13947.37 }),
    ]);
    expect(planned.drafts).toHaveLength(1);
    expect(planned.drafts[0].lines.map((line) => line.qty)).toEqual([1, 1]);
    expect(planned.drafts[0].subtotal).toBe(34289.48);
    expect(planned.drafts[0].vat).toBe(5143.42);
    expect(planned.drafts[0].total).toBe(39432.9);
    expect(poTotals([{ qty: 1, unitCost: 20342.11 }, { qty: 1, unitCost: 13947.37 }]).total).toBe(39432.9);
  });

  it("splits suppliers and skips a line that is already on a purchase order", () => {
    const planned = planJobPurchaseOrders([
      midea({ alreadyOnPo: true }),
      midea({ quoteItemId: "qi-24", supplierId: "other", supplierName: "Other supplier", quotedQty: 2, onHand: 1, unitCostExcl: 100 }),
    ]);
    expect(planned.covered).toEqual(["qi-36"]);
    expect(planned.drafts).toHaveLength(1);
    expect(planned.drafts[0]).toMatchObject({ supplierName: "Other supplier" });
    expect(planned.drafts[0].lines[0].qty).toBe(1);
  });

  it("leaves a missing catalogue price off the order", () => {
    const planned = planJobPurchaseOrders([midea({ unitCostExcl: null }), midea({ quoteItemId: "zero", unitCostExcl: 0 })]);
    expect(planned.drafts).toEqual([]);
    expect(planned.missingPrice.map((item) => item.code)).toEqual(["INVEXT-36", "INVEXT-36"]);
  });
});

describe("supplier email and the company name on the purchase order", () => {
  it("saves typed addresses and never stores the accounts copy as the supplier email", () => {
    expect(emailsOnFile([], null)).toEqual([]);
    expect(emailsOnFile(["orders@supplier.example"], null)).toEqual(["orders@supplier.example"]);
    const saved = supplierEmailsToSave([], ["orders@supplier.example", "accounts@0800becool.co.za", "bad"]);
    expect(saved).toEqual(["orders@supplier.example"]);
    expect(parseEmailList("one@supplier.example, two@supplier.example").emails).toEqual(["one@supplier.example", "two@supplier.example"]);
    expect(poRecipients(saved)).toEqual({ to: ["orders@supplier.example"], cc: ["accounts@0800becool.co.za"] });
  });

  it("uses Massair CT and drops the trading style", () => {
    expect(poIssuerName("Massair CT (Pty) Ltd t/a 0800-BE-COOL")).toBe("Massair CT (Pty) Ltd");
    expect(poIssuerName("Massair Ind CC")).toBe("Massair CT (Pty) Ltd");
    expect(poIssuerName("")).toBe("Massair CT (Pty) Ltd");
    const html = purchaseOrderEmailHtml({
      companyName: "Massair CT (Pty) Ltd",
      poNumber: "PO-MLG-01",
      supplierName: "MIDEA - LIVANCE",
      lines: [{ qty: 1, code: "INVEXT-36", description: "INVEXT-36", lineTotal: 20342.11 }],
      total: 39432.9,
    });
    expect(poTextHasBanned(html)).toBe(false);
    expect(html).toContain("accounts@0800becool.co.za");
    expect(html).toContain("Massair CT (Pty) Ltd");
  });
});

describe("the purchase order migration does not touch quotes", () => {
  const sql = readFileSync("supabase/migrations/20261123153000_job_unit_purchase_orders.sql", "utf8");

  it("does not name a quote or update quote, invoice, or stock rows", () => {
    const widened = readFileSync("supabase/migrations/20261123160000_job_shortage_unit_match.sql", "utf8");
    expect(widened).toContain("job_shortage_is_unit");
    expect(widened).toContain("INVEXT");
    expect(widened).not.toMatch(/UPDATE\s+public\.quotes/i);
    expect(widened).not.toMatch(/Q-2026-0063/);
    expect(sql).not.toMatch(/Q-2026-0063/);
    expect(sql).not.toMatch(/UPDATE\s+public\.quotes/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.invoices/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.quote_items/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.cf_stock_items/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.stock_units/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.stock_movements/i);
    expect(sql).toMatch(/UPDATE\s+public\.suppliers\s+SET\s+order_emails/i);
    expect(sql).toMatch(/awaiting_stock\s*=\s*true/);
    expect(sql).toContain("accounts@0800becool.co.za");
    expect(sql).toContain("ac_unit");
    expect(sql).toContain("create_draft_pos_for_job");
    expect(sql).toContain("set_supplier_order_emails");
  });
});

describe("stock orders card and purchase order preview", () => {
  const row = {
    jobId: "job-1",
    href: "/admin/jobs/job-1",
    title: "Mark Le Grange",
    when: "Thu 26 Nov",
    lines: [
      { key: "qi-36", label: "INVEXT-36", state: "needs" as const, poNumber: null, poId: null, dateLabel: null, shortQty: 1 },
      { key: "qi-24", label: "INVEXT-24-R32", state: "needs" as const, poNumber: null, poId: null, dateLabel: null, shortQty: 1 },
    ],
  };

  it("offers Create and opens the purchase order from Review and the row chevron", () => {
    const onCreate = vi.fn();
    render(
      <MemoryRouter>
        <StockOrdersCard orders={[]} unitRows={[row]} count={2} stockHref="/admin/cash-health?tab=stock" onCreate={onCreate} onReview={onCreate} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("stock-orders-count")).toHaveTextContent("2");
    expect(screen.getAllByTestId("needs-ordering")).toHaveLength(2);
    expect(screen.getByTestId("create-purchase-order")).toHaveTextContent("Create purchase order");
    const review = screen.getByTestId("stock-orders-review");
    expect(review.tagName).toBe("BUTTON");
    expect(review).toHaveTextContent("Review 2 items to order");
    expect(review).not.toHaveAttribute("href");
    fireEvent.click(review);
    fireEvent.click(screen.getAllByTestId("stock-order-open")[0]);
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onCreate).toHaveBeenCalledWith("job-1");
    expect(screen.queryByRole("link", { name: /Review 2 items/ })).toBeNull();
  });

  it("shows PO raised and does not nag once a draft covers the lines", () => {
    render(
      <MemoryRouter>
        <StockOrdersCard
          orders={[]}
          count={0}
          stockHref="/stock"
          onReview={() => {}}
          unitRows={[{
            ...row,
            lines: row.lines.map((line) => ({ ...line, state: "raised" as const, poNumber: "PO-MLG-01", shortQty: null })),
          }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("stock-orders-count")).toHaveTextContent("0");
    expect(screen.getAllByTestId("po-raised")[0]).toHaveTextContent("PO raised · PO-MLG-01");
    expect(screen.queryByTestId("create-purchase-order")).toBeNull();
    expect(screen.queryByText("Needs ordering")).toBeNull();
    expect(screen.getByTestId("review-purchase-order")).toBeInTheDocument();
  });

  it("shows Ordered with the number and date and no second purchase order", () => {
    render(
      <MemoryRouter>
        <StockOrdersCard
          orders={[]}
          count={0}
          stockHref="/stock"
          onCreate={() => {}}
          unitRows={[{
            ...row,
            lines: row.lines.map((line) => ({ ...line, state: "ordered" as const, poNumber: "PO-MLG-01", dateLabel: "23 Nov 2026", shortQty: null })),
          }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("po-ordered")[0]).toHaveTextContent("Ordered · PO-MLG-01 · 23 Nov 2026");
    expect(screen.queryByTestId("create-purchase-order")).toBeNull();
    expect(screen.queryByTestId("review-purchase-order")).toBeNull();
  });

  it("shows a filled supplier email and does not send on its own", () => {
    const onSend = () => { throw new Error("send"); };
    render(
      <PurchaseOrderPreview
        embedded
        companyName="Massair CT (Pty) Ltd t/a 0800-BE-COOL"
        drafts={[{
          id: "po-1", poNumber: "PO-MLG-01", status: "draft", supplierId: "livance", supplierName: "MIDEA - LIVANCE",
          emails: ["orders@supplier.example"],
          lines: [
            { code: "INVEXT-36", description: "INVEXT-36", qty: 1, unitCost: 20342.11, lineTotal: 20342.11 },
            { code: "INVEXT-24-R32", description: "INVEXT-24-R32", qty: 1, unitCost: 13947.37, lineTotal: 13947.37 },
          ],
          subtotal: 34289.48, vat: 5143.42, total: 39432.9,
          sentAt: null, createdAt: null, clientName: "Mark Le Grange", jobReference: "Thu 26 Nov", accountNumber: null,
        }]}
        emails={{ "po-1": "orders@supplier.example" }}
        onEmails={() => {}}
        onSend={onSend}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("po-company")).toHaveTextContent("Massair CT (Pty) Ltd");
    expect(screen.getByTestId("po-company")).not.toHaveTextContent("t/a");
    expect(screen.getByTestId("po-supplier")).toHaveTextContent("MIDEA - LIVANCE");
    expect(screen.getByTestId("po-email-filled")).toHaveValue("orders@supplier.example");
    expect(screen.getByTestId("po-total")).toHaveTextContent("39 432,90");
    expect(screen.getByTestId("po-docs")).toHaveTextContent("accounts@0800becool.co.za");
    expect(screen.getByTestId("send-po")).toBeEnabled();
    expect(poTextHasBanned(document.body.textContent || "")).toBe(false);
  });

  it("asks for an email when none is on file and keeps Send off", () => {
    const onSend = () => { throw new Error("send"); };
    render(
      <PurchaseOrderPreview
        embedded
        companyName="Massair Ind CC"
        drafts={[{
          id: "po-1", poNumber: "PO-MLG-01", status: "draft", supplierId: "livance", supplierName: "MIDEA - LIVANCE",
          emails: [], lines: [{ code: "INVEXT-36", description: "INVEXT-36", qty: 1, unitCost: 20342.11, lineTotal: 20342.11 }],
          subtotal: 20342.11, vat: 3051.32, total: 23393.43,
          sentAt: null, createdAt: null, clientName: "Mark Le Grange", jobReference: null, accountNumber: null,
        }]}
        emails={{ "po-1": "" }}
        onEmails={() => {}}
        onSend={onSend}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("po-email-manual")).toHaveValue("");
    expect(screen.getByText(/No email on file/)).toBeInTheDocument();
    expect(screen.getByTestId("send-po")).toBeDisabled();
    expect(screen.getByTestId("po-company")).toHaveTextContent("Massair CT (Pty) Ltd");
    expect(screen.getByTestId("po-company")).not.toHaveTextContent("Ind");
  });
});
