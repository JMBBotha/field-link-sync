import { stampDate, type InvoiceStamp } from "@/lib/invoiceStamps";

/**
 * Outlined, slightly rotated rubber stamps. Rendered in normal flow (a row of its own under the
 * header), so it can never sit on top of totals or banking details. Inline styles so the PDF capture
 * (html2canvas of the on-screen document) prints it exactly the same.
 */
export default function InvoiceStamps({ stamps, className, center }: { stamps: InvoiceStamp[]; className?: string; center?: boolean }) {
  if (!stamps.length) return null;
  return (
    <div data-testid="invoice-stamps" className={className} style={{ display: "flex", flexWrap: "wrap", justifyContent: center ? "center" : "flex-end", gap: 14, padding: center ? "4px 0 12px" : "10px 4px 2px", pointerEvents: "none" }}>
      {stamps.map((s, i) => (
        <div key={s.kind} data-testid={`stamp-${s.kind}`} aria-label={`${s.label} ${s.date}`}
          style={{ transform: `rotate(${i % 2 ? 4 : -6}deg)`, border: `3px solid ${s.color}`, borderRadius: 9, padding: 2, opacity: 0.9, background: "rgba(255,255,255,0.7)" }}>
          <div style={{ border: `1px solid ${s.color}`, borderRadius: 6, color: s.color, padding: "4px 12px 8px", textAlign: "center", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: 15, lineHeight: "18px", fontWeight: 900, letterSpacing: 2 }}>{s.label}</div>
            <div style={{ fontSize: 11, lineHeight: "14px", fontWeight: 700, letterSpacing: 1 }}>{stampDate(s.date)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
