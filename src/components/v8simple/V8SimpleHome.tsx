import { Link, useSearchParams } from "react-router-dom";
import { v8SimpleAllPages } from "@/lib/v8simple/allPages";
import { V8_DEMO_COMPANY, V8_DEMO_EFT, V8_DEMO_INVOICES, V8_DEMO_JOBS } from "@/lib/v8simple/demoJobs";
import { v8FilterJobs, v8JobCounts, v8MoneyView, v8Rand, v8UnacceptedLeadAlert } from "@/lib/v8simple/jobs";
import { usePreviewRole } from "./V8SimpleShell";

const COPY = {
  admin: {
    title: "Home",
    line: "Money waiting, jobs ready to book, and leads sitting too long will sit on this page.",
  },
  sales: {
    title: "Home",
    line: "A new lead offer, then quotes to chase, will sit on this page. A site visit stays free.",
  },
  tech: {
    title: "Today",
    line: "Your next job will sit here, with a Start job button. This screen shows no money totals.",
  },
} as const;

const MONEY_AT = new Date("2026-11-17T08:00:00+02:00");
const LEAD_WAITING_MIN = 12;

export function V8SimpleHome() {
  const role = usePreviewRole();
  if (role === "admin") return <AdminHome />;
  const copy = COPY[role];
  return (
    <section className="rh-intro" data-testid="v8-simple-home">
      <div className="rh-frost" aria-hidden />
      <div className="rh-body">
        <p className="rh-eyebrow">Tuesday, 17 Nov</p>
        <h1 className="v8s-h1">{copy.title}</h1>
        <p className="rh-muted">{copy.line}</p>
      </div>
    </section>
  );
}

function AdminHome() {
  const [sp] = useSearchParams();
  const counts = v8JobCounts(V8_DEMO_JOBS);
  const figures = v8MoneyView({ companyId: V8_DEMO_COMPANY, invoices: V8_DEMO_INVOICES, now: MONEY_AT }, V8_DEMO_EFT);
  const ready = v8FilterJobs(V8_DEMO_JOBS, "ready", false);
  const alert = v8UnacceptedLeadAlert(LEAD_WAITING_MIN, "Installation", "Southern suburbs");
  const moneyQuery = new URLSearchParams(sp);
  moneyQuery.set("view", "money");
  moneyQuery.delete("stage");
  moneyQuery.delete("job");
  return (
    <div data-testid="v8-admin-home">
      <Link to={`jobs?${moneyQuery.toString()}`} className="v8s-money v8s-money-home" data-testid="v8-money-waiting">
        <div>
          <div className="rh-label">Money waiting</div>
          <div className="rh-big">{v8Rand(figures.depositDue + figures.balanceDue)}</div>
          <p>{counts.deposit_due} deposit due · {counts.balance_due} balance due · {V8_DEMO_EFT.length} EFT to match</p>
        </div>
        <span data-orange="main">Collect money</span>
      </Link>
      <section className="rh-card" data-testid="v8-ready-card">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <div className="rh-head">
            <h2>Ready to book</h2>
            <span className="rh-count" data-testid="v8-ready-count">{counts.ready}</span>
          </div>
          <p className="rh-muted">Deposit paid, no technician yet.</p>
          {ready.map((row) => (
            <Link key={row.id} to={`jobs/${row.id}?${sp.toString()}`} className="v8s-page-link">{row.client}<span>{row.area}</span></Link>
          ))}
        </div>
      </section>
      {alert && (
        <section className="rh-card" data-testid="v8-lead-alert">
          <div className="rh-frost" aria-hidden />
          <div className="rh-body">
            <p className="rh-eyebrow">Unaccepted lead</p>
            <h2>{alert.text}</h2>
            <p className="rh-muted">No name on this alert. It shows after 10 minutes.</p>
          </div>
        </section>
      )}
    </div>
  );
}

export function V8SimpleSoon({ title, line }: { title: string; line: string }) {
  return (
    <section className="rh-card" data-testid="v8-simple-soon">
      <div className="rh-frost" aria-hidden />
      <div className="rh-body">
        <p className="rh-eyebrow">Coming in this preview</p>
        <h1 className="v8s-h1">{title}</h1>
        <p className="rh-muted">{line}</p>
      </div>
    </section>
  );
}

export function V8SimpleMe() {
  const role = usePreviewRole();
  const groups = v8SimpleAllPages(role);
  return (
    <div data-testid="v8-simple-me">
      <section className="rh-intro">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <p className="rh-eyebrow">Settings</p>
          <h1 className="v8s-h1">All pages</h1>
          <p className="rh-muted">
            {role === "tech"
              ? "Your own pages. Money totals and booking a new sale stay off this menu."
              : "Every page that already exists. Nothing here was removed from its old address."}
          </p>
        </div>
      </section>
      {groups.map((group) => (
        <section key={group.title} className="rh-card" data-testid="v8-simple-page-group">
          <div className="rh-frost" aria-hidden />
          <div className="rh-body">
            <h2>{group.title}</h2>
            {group.links.map((link) => (
              <Link key={link.path} to={link.path} className="v8s-page-link">
                {link.label}
                <span>{link.path}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
