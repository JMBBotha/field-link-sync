import { coversErfLine } from "@/lib/firstFit";

export interface CoverHouse {
  house_no: string;
  scope?: string | null;
  note?: string | null;
  amount_incl?: number | null;
  invoice_number?: string | null;
}

/** "Covers ERF …" for an invoice that bills several houses without splitting the invoice. */
export default function InvoiceCoversLine({ houses }: { houses: CoverHouse[] }) {
  const nos = houses.map((h) => h.house_no).filter(Boolean);
  if (!nos.length) return null;
  const notes = [...new Set(houses.map((h) => (h.note || "").trim()).filter(Boolean))];
  return (
    <div className="rounded-lg border bg-card px-4 py-3 text-card-foreground" data-testid="invoice-covers">
      <div className="text-sm font-semibold text-foreground">{coversErfLine(nos)}</div>
      {notes.length === 1 && <div className="mt-0.5 text-xs text-muted-foreground">{notes[0]}</div>}
    </div>
  );
}
