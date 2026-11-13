import { formatRand } from "@/utils/formatRand";
import type { DepositCallout } from "@/lib/invoiceDepositCallout";

const formatPercent = (n: number) => `${Math.round(n * 100) / 100}%`;

/**
 * Prominent deposit request on the invoice paper (screen and PDF capture).
 * Colours are written inline so html2canvas prints them, and so dark mode
 * cannot turn the ink white on the white page. Display only.
 */
export default function DepositDueBlock({ model }: { model: DepositCallout }) {
  const paid = model.state === "paid";
  const headline = paid ? model.depositAmount : model.depositOutstanding;
  const percent = model.percent != null ? formatPercent(model.percent) : null;
  const detail = paid
    ? (percent ? `${percent} of the total, incl. VAT` : "Incl. VAT")
    : model.received > 0.005
      ? `${percent ? `${percent} deposit · ` : ""}${formatRand(model.depositAmount)} requested · ${formatRand(model.received)} received, incl. VAT`
      : (percent ? `${percent} of the total, incl. VAT` : "Incl. VAT");
  const balanceLabel = paid ? "Balance due" : "Balance remaining";
  return (
    <div
      data-testid="deposit-due-block"
      data-state={model.state}
      data-pdf-keep
      style={{
        margin: "14px 0 4px",
        border: "1px solid #3D9BEB",
        borderLeft: "6px solid #C2410C",
        borderRadius: 8,
        background: "#ffffff",
        color: "#1d2a3a",
        overflow: "hidden",
      }}
    >
      <div style={{ background: "#3D9BE8", color: "#ffffff", padding: "7px 14px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <span style={{ fontWeight: 800, letterSpacing: "0.08em", fontSize: 12 }}>{paid ? "DEPOSIT PAID" : "DEPOSIT DUE"}</span>
        {percent ? <span style={{ fontWeight: 700, fontSize: 12 }}>{percent}</span> : null}
      </div>
      <div style={{ padding: "10px 14px 12px", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div data-testid="deposit-due-amount" style={{ fontSize: 26, lineHeight: 1.1, fontWeight: 800, color: paid ? "#1d2a3a" : "#C2410C" }}>{formatRand(headline)}</div>
          <div data-testid="deposit-due-detail" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.35, color: "#3a4859" }}>{detail}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: "#3D9BEB" }}>{balanceLabel.toUpperCase()}</div>
          <div data-testid="deposit-due-balance" style={{ fontSize: 18, lineHeight: 1.2, fontWeight: 800, color: paid && model.balanceRemaining > 0.005 ? "#C2410C" : "#1d2a3a" }}>{formatRand(model.balanceRemaining)}</div>
        </div>
      </div>
    </div>
  );
}
