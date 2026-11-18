import { useState } from "react";
import { V8_DEMO_EFT_EXPECTS, V8_DEMO_FNB_LINES } from "@/lib/v8simple/demoJobs";
import { CsvPdfImportSource, v8AutoMatchEft, v8CanUndoEft, v8MarkEftReceived, type V8ManualEft } from "@/lib/v8simple/eftMatch";
import { v8Rand } from "@/lib/v8simple/jobs";

const TODAY = "2026-11-18";

/** Manual EFT received first. Auto-match only reads the imported statement. */
export function V8EftPanel({ onlyId }: { onlyId?: string }) {
  const expects = V8_DEMO_EFT_EXPECTS.filter((row) => !onlyId || row.id === onlyId);
  const auto = v8AutoMatchEft(new CsvPdfImportSource(V8_DEMO_FNB_LINES), expects);
  const [manual, setManual] = useState<V8ManualEft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const leftover = expects.filter((row) => !auto.matched.some((hit) => hit.expectId === row.id) && manual?.expectId !== row.id);
  return (
    <section data-testid="v8-eft-panel">
      {leftover.map((row) => (
        <div key={row.id}>
          <p>{row.client} · {row.quoteNo} · {v8Rand(row.amount)} is still waiting.</p>
          <button
            type="button"
            className="v8s-ghost"
            data-testid="v8-eft-received"
            onClick={() => {
              const marked = v8MarkEftReceived(row, { amount: row.amount, date: TODAY, who: "Demo admin" });
              if ("error" in marked) setError(marked.error);
              else { setManual(marked); setError(null); }
            }}
          >
            EFT received
          </button>
        </div>
      ))}
      {manual && (
        <p data-testid="v8-eft-manual">
          EFT received · {v8Rand(manual.amount)} · {manual.date} · {manual.who}. Ready to book.
          {v8CanUndoEft(manual.date, TODAY) && (
            <button type="button" data-testid="v8-eft-undo" onClick={() => setManual(null)}>Undo</button>
          )}
        </p>
      )}
      {error && <p>{error}</p>}
      {auto.matched.map((hit) => (
        <p key={hit.lineId} data-testid="v8-eft-auto">Matched from imported statement · {hit.reference} · {v8Rand(hit.amount)} · {hit.date}. Ready to book.</p>
      ))}
    </section>
  );
}
