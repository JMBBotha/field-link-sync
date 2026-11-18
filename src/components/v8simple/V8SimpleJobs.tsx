import { useSearchParams } from "react-router-dom";
import { v8BalanceOnJobDone } from "@/lib/v8simple/balance";
import { V8EftPanel } from "@/components/v8simple/V8EftPanel";
import { V8_DEMO_COMPANY, V8_DEMO_EFT, V8_DEMO_INVOICES, V8_DEMO_JOBS } from "@/lib/v8simple/demoJobs";
import { V8_JOB_PILLS, v8FilterJobs, v8JobCounts, v8JobStage, v8MoneyView, v8Rand } from "@/lib/v8simple/jobs";
import { usePreviewRole } from "./V8SimpleShell";

const MONEY_AT = new Date("2026-11-17T08:00:00+02:00");

export function V8SimpleJobs() {
  const role = usePreviewRole();
  const [sp, setSp] = useSearchParams();
  if (role === "tech") {
    return (
      <section className="rh-card" data-testid="v8-jobs-tech">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h1 className="v8s-h1">Today</h1>
          <p className="rh-muted">The jobs list is for the office. Your work stays on Today, with no money totals.</p>
        </div>
      </section>
    );
  }

  const stage = sp.get("stage");
  const money = role === "admin" && sp.get("view") === "money";
  const selectedId = sp.get("job");
  const counts = v8JobCounts(V8_DEMO_JOBS);
  const rows = v8FilterJobs(V8_DEMO_JOBS, stage, money);
  const selected = V8_DEMO_JOBS.find((row) => row.id === selectedId) || rows[0] || null;
  const figures = v8MoneyView({ companyId: V8_DEMO_COMPANY, invoices: V8_DEMO_INVOICES, now: MONEY_AT }, V8_DEMO_EFT);
  const allCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const pills = V8_JOB_PILLS.filter((pill, index, all) => all.findIndex((item) => item.key === pill.key) === index);

  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };

  return (
    <div data-testid="v8-jobs" data-view={money ? "money" : "list"}>
      <div className="v8s-pills" role="tablist" aria-label="Stage">
        <button type="button" className={`v8s-pill${!stage && !money ? " is-on" : ""}`} onClick={() => setQuery({ stage: null, view: null })}>
          All <b>{allCount}</b>
        </button>
        {pills.map((pill) => (
          <button
            key={pill.key}
            type="button"
            data-testid={`v8-pill-${pill.key}`}
            className={`v8s-pill${stage === pill.key && !money ? " is-on" : ""}`}
            onClick={() => setQuery({ stage: pill.key, view: null, job: null })}
          >
            {pill.label} <b data-testid={`v8-count-${pill.key}`}>{counts[pill.key] || 0}</b>
          </button>
        ))}
        {role === "admin" && (
          <button type="button" data-testid="v8-money-view" className={`v8s-pill v8s-pill-money${money ? " is-on" : ""}`} onClick={() => setQuery({ view: "money", stage: null })}>
            Money
          </button>
        )}
      </div>

      {money && (
        <section className="v8s-money" data-testid="v8-money-totals">
          <div><span>Deposit due</span><strong>{v8Rand(figures.depositDue)}</strong></div>
          <div><span>Balance due</span><strong>{v8Rand(figures.balanceDue)}</strong></div>
          <div><span>EFTs to match</span><strong>{v8Rand(figures.eftToMatch)}</strong></div>
          <p>Same deposit and balance totals as the admin home. An EFT stays here until someone matches it. Reference is the quote number.</p>
          <p data-testid="v8-balance-built">Job done today builds a balance of {v8Rand(v8BalanceOnJobDone({ quoteNo: "Q-1088", quoteTotal: 20000, deposit: 14000, callOutExclVat: 680, doneOn: "2026-11-17" }).total)}, due the same day. The call-out is not deducted.</p>
          <ul>
            {V8_DEMO_EFT.map((eft) => (
              <li key={eft.id}>{eft.client} · ref {eft.reference} · {v8Rand(eft.amount)}</li>
            ))}
          </ul>
          <V8EftPanel />
        </section>
      )}

      <div className="v8s-split">
        <ul className="v8s-list" data-testid="v8-job-list">
          {rows.map((row) => {
            const got = v8JobStage(row);
            const on = selected?.id === row.id;
            return (
              <li key={row.id}>
                <button type="button" className={on ? "is-on" : ""} data-testid={`v8-job-${row.id}`} onClick={() => setQuery({ job: row.id })}>
                  <span>
                    <strong>{row.client}</strong>
                    <small>{row.work} · {row.area}{row.quoteNo ? ` · ${row.quoteNo}` : ""}</small>
                  </span>
                  <em>{got.label}</em>
                </button>
              </li>
            );
          })}
          {rows.length === 0 && <li className="v8s-empty">Nothing in this stage.</li>}
        </ul>
        <aside className="v8s-preview" data-testid="v8-job-preview">
          {selected ? (
            <>
              <p className="rh-eyebrow">{v8JobStage(selected).label}</p>
              <h1 className="v8s-h1">{selected.client}</h1>
              <p className="rh-muted">{selected.work} · {selected.area}</p>
              {selected.quoteNo && <p className="rh-muted">Quote {selected.quoteNo}</p>}
            </>
          ) : (
            <p className="rh-muted">Choose a job.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
