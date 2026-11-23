import { useSearchParams } from "react-router-dom";
import { StockOrdersCard } from "@/components/purchasing/StockOrdersCard";
import { PurchaseOrderPreview } from "@/components/purchasing/PurchaseOrderPreview";
import { poTotals, type PoDraftView, type UnitShortageRow } from "@/lib/jobPurchaseOrder";

/**
 * Signed-out sample for screenshots. Costs are the catalogue backup figures for
 * INVEXT-36 (20342.11) and INVEXT-24-R32 (13947.37). Nothing here is saved.
 * Quote Q-2026-0063 is a label only.
 */
const COSTS = { "INVEXT-36": 20342.11, "INVEXT-24-R32": 13947.37 };
const totals = poTotals([
  { qty: 1, unitCost: COSTS["INVEXT-36"] },
  { qty: 1, unitCost: COSTS["INVEXT-24-R32"] },
]);

const needsRow: UnitShortageRow = {
  jobId: "demo-job",
  href: "/dev/po-order?shot=card",
  title: "Mark Le Grange",
  when: "Thu 26 Nov · MIDEA - LIVANCE",
  lines: [
    { key: "36", label: "INVEXT-36", state: "needs", poNumber: null, poId: null, dateLabel: null, shortQty: 1 },
    { key: "24", label: "INVEXT-24-R32", state: "needs", poNumber: null, poId: null, dateLabel: null, shortQty: 1 },
  ],
};

const raisedRow: UnitShortageRow = {
  ...needsRow,
  href: "/dev/po-order?shot=raised",
  lines: needsRow.lines.map((line) => ({
    ...line,
    state: "raised",
    poNumber: "PO-MLG-01",
    shortQty: null,
  })),
};

const orderedRow: UnitShortageRow = {
  ...needsRow,
  href: "/dev/po-order?shot=ordered",
  lines: needsRow.lines.map((line) => ({
    ...line,
    state: "ordered",
    poNumber: "PO-MLG-01",
    dateLabel: "23 Nov 2026",
    shortQty: null,
  })),
};

const draft: PoDraftView = {
  id: "demo-po",
  poNumber: "PO-MLG-01",
  status: "draft",
  supplierId: "livance",
  supplierName: "MIDEA - LIVANCE",
  emails: [],
  lines: [
    { code: "INVEXT-36", description: "INVEXT-36", qty: 1, unitCost: COSTS["INVEXT-36"], lineTotal: COSTS["INVEXT-36"] },
    { code: "INVEXT-24-R32", description: "INVEXT-24-R32", qty: 1, unitCost: COSTS["INVEXT-24-R32"], lineTotal: COSTS["INVEXT-24-R32"] },
  ],
  subtotal: totals.subtotal,
  vat: totals.vat,
  total: totals.total,
  sentAt: null,
  createdAt: "2026-11-23T08:00:00+02:00",
  clientName: "Mark Le Grange",
  jobReference: "Thu 26 Nov · Quote Q-2026-0063",
  accountNumber: null,
};

export default function PoOrderHarness() {
  const [params] = useSearchParams();
  const shot = params.get("shot") || "card";
  const filled = shot !== "manual";
  return (
    <div className="home-fit" style={{ background: "#e7eef5", minHeight: "100vh", padding: 12 }} data-testid="po-order-harness">
      {(shot === "card" || shot === "ordered" || shot === "raised") && (
        <div className="rh-grid">
          <StockOrdersCard
            orders={[]}
            unitRows={[shot === "ordered" ? orderedRow : shot === "raised" ? raisedRow : needsRow]}
            count={shot === "card" ? 2 : 0}
            stockHref="/dev/po-order?shot=card"
            onCreate={() => {}}
            onReview={() => {}}
          />
        </div>
      )}
      {(shot === "preview" || shot === "manual") && (
        <PurchaseOrderPreview
          embedded
          companyName="Massair CT (Pty) Ltd"
          drafts={[{ ...draft, emails: filled ? ["orders@supplier.example"] : [] }]}
          emails={{ "demo-po": filled ? "orders@supplier.example" : "" }}
          onEmails={() => {}}
          onSend={() => {}}
          onClose={() => {}}
        />
      )}
    </div>
  );
}
