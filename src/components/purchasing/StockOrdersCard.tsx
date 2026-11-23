import { Link } from "react-router-dom";
import type { StockOrder } from "@/lib/materialCheck";
import type { UnitShortageRow } from "@/lib/jobPurchaseOrder";
import { Glass } from "@/components/v8/roleHome/chrome";

const quietLink = { color: "inherit", textDecoration: "none" } as const;

function lineState(line: UnitShortageRow["lines"][number]) {
  if (line.state === "ordered") {
    return <span className="rh-po-ordered" data-testid="po-ordered">Ordered · {line.poNumber}{line.dateLabel ? ` · ${line.dateLabel}` : ""}</span>;
  }
  if (line.state === "raised") {
    return <span className="rh-po-ordered" data-testid="po-raised">PO raised · {line.poNumber}</span>;
  }
  return <span className="rh-needs" data-testid="needs-ordering">Needs ordering</span>;
}

export function UnitOrderJobs({
  rows,
  onCreate,
  onReview,
  busyJobId,
}: {
  rows: UnitShortageRow[];
  onCreate?: (jobId: string) => void;
  onReview?: (jobId: string) => void;
  busyJobId?: string | null;
}) {
  return (
    <>
      {rows.map((row) => {
        const open = row.lines.some((line) => line.state === "needs");
        const raised = row.lines.some((line) => line.state === "raised");
        return (
          <div key={row.jobId} className="rh-po-job" data-testid="stock-order-job">
            <Link to={row.href} style={quietLink}><b>{row.title}</b></Link>
            <div className="rh-muted">{row.when}</div>
            {row.lines.map((line) => (
              <div key={line.key} className="rh-po-line" data-testid="stock-order-line">
                <span>{line.label}{line.state === "needs" && line.shortQty != null ? ` · short ${line.shortQty}` : ""}</span>
                {lineState(line)}
              </div>
            ))}
            {open && onCreate && (
              <button
                type="button"
                className="rh-btn"
                data-testid="create-purchase-order"
                disabled={busyJobId === row.jobId}
                onClick={() => onCreate(row.jobId)}
              >
                {busyJobId === row.jobId ? "Preparing…" : "Create purchase order"}
              </button>
            )}
            {!open && raised && onReview && (
              <button type="button" className="rh-btn" data-testid="review-purchase-order" onClick={() => onReview(row.jobId)}>
                Review purchase order
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Stock orders this week. Covered lines show PO raised or Ordered and are not a nag. */
export function StockOrdersCard({
  orders,
  unitRows = [],
  count,
  stockHref,
  onCreate,
  onReview,
  busyJobId,
}: {
  orders: StockOrder[];
  unitRows?: UnitShortageRow[];
  count?: number;
  stockHref: string;
  onCreate?: (jobId: string) => void;
  onReview?: (jobId: string) => void;
  busyJobId?: string | null;
}) {
  const needs = unitRows.reduce((sum, row) => sum + row.lines.filter((line) => line.state === "needs").length, 0);
  const nag = count ?? orders.length + needs;
  const quiet = orders.length === 0 && unitRows.length === 0;
  return (
    <Glass testId="stock-orders">
      <div className="rh-head">
        <Link to={stockHref} data-testid="stock-orders-heading" style={quietLink}><h2>Stock orders this week</h2></Link>
        <span className="rh-count" data-testid="stock-orders-count">{nag}</span>
      </div>
      <div className="rh-muted">From upcoming job material checks</div>
      {quiet && <p className="rh-muted">Nothing short against stock.</p>}
      <UnitOrderJobs rows={unitRows} onCreate={onCreate} onReview={onReview} busyJobId={busyJobId} />
      {orders.map((order) => (
        <Link key={order.key} to={order.href} className="rh-material" data-testid="stock-order">
          <span><b style={{ display: "block" }}>{order.label}</b><span className="rh-muted">{order.detail}</span></span>
          <span className="rh-arrow">›</span>
        </Link>
      ))}
      {nag > 0 && needs === 0 && (
        <Link to={stockHref} className="rh-btn secondary" style={{ marginTop: 8 }} data-testid="stock-orders-review">
          Review {nag} item{nag === 1 ? "" : "s"} to order →
        </Link>
      )}
    </Glass>
  );
}
