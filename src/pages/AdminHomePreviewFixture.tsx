/**
 * Signed-out phone fixture for the Admin Home preview.
 * Sample rows only. This is not Massair CT and it does not email or create a job.
 */
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, CalendarDays, Home, MoreHorizontal, Wallet } from "lucide-react";
import { AdminHomeScreen } from "@/components/v8/roleHome/screens";
import JobsCalmView from "@/components/jobs/calm/JobsCalmView";
import RoleMapFrame from "@/components/v8/roleHome/RoleMapFrame";
import { HowCountedSheet } from "@/components/v8/AdminHomeFigures";
import { countAdminHome } from "@/lib/adminHomeCount";
import { ADMIN_HOME_ROUTES, cashProjectionSlices } from "@/lib/roleHome";
import { buildYardHome } from "@/lib/yardView";
import "@/components/v8/v8.css";

const DEMO = "00000000-0000-4000-8000-0000000000aa";
const FIXTURE_NOW = new Date("2026-11-07T15:33:00Z");
const fixtureInvoices = [
  { id: "fixture-draft", company_id: DEMO, status: "draft", grand_total: 76426.79, invoice_number: "0010016", customer_name: "Fixture client" },
  { id: "fixture-dep", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 12000, notes: "DEPOSIT", invoice_number: "D-1", customer_name: "Fixture client", expected_deposit_date: "2026-11-12" },
  { id: "fixture-final", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 8000, notes: "Final", invoice_number: "F-1", customer_name: "Fixture client", expected_final_date: "2026-11-28" },
];
const counts = countAdminHome({ companyId: DEMO, now: FIXTURE_NOW, invoices: fixtureInvoices });
const fixtureMoney = buildYardHome({
  companyId: DEMO,
  now: FIXTURE_NOW,
  invoices: fixtureInvoices,
  bankState: "ready",
  bank: {
    accounts: [{ id: "fixture-bank", label: "Fixture current", account_ref: null, include: true, sort: 1 }],
    balances: [{ id: "fixture-bal", account_id: "fixture-bank", balance: 12500, as_of: "2026-11-03", created_at: "2026-11-03T08:00:00Z" }],
  },
  booksState: "ready",
  books: { receipts: [], commitments: [], allocations: [] },
});

function Banner() {
  return (
    <p data-testid="fixture-label" style={{ margin: "0 0 10px", padding: "8px 10px", borderRadius: 10, background: "#0F1B2A", color: "#fff", fontSize: 12, fontWeight: 700 }}>
      FIXTURE · signed out · Demo - harness, not live Massair CT totals
    </p>
  );
}

function Tabs({ view }: { view: string }) {
  const item = (id: string, label: string, icon: ReactNode) => (
    <Link to={`/dev/admin-home?view=${id}`} className={view === id ? "v8-tab is-active" : "v8-tab"} style={{ color: "#fff", textDecoration: "none" }}>
      {icon}<span>{label}</span>
    </Link>
  );
  return (
    <nav className="v8-tabs" data-testid="fixture-bottom-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 40, display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", height: 64 }}>
      {item("home", "Home", <Home className="h-5 w-5" />)}
      {item("jobs", "Jobs", <Briefcase className="h-5 w-5" />)}
      {item("review", "Invoices", <Wallet className="h-5 w-5" />)}
      {item("jobs", "Schedule", <CalendarDays className="h-5 w-5" />)}
      <button type="button" className="v8-tab" style={{ color: "#fff", background: "none", border: 0 }}><MoreHorizontal className="h-5 w-5" /><span>More</span></button>
    </nav>
  );
}

function ReviewFixture({ preview }: { preview: boolean }) {
  const [open, setOpen] = useState(preview);
  const [sent, setSent] = useState(false);
  return (
    <div className="space-y-3 p-3 pb-24" data-testid="fixture-review">
      <Banner />
      <h1 className="text-2xl font-extrabold text-[#0F1B2A]">Draft invoices</h1>
      <p className="text-sm text-[#4e6d86]">Live app opens {ADMIN_HOME_ROUTES.reviewSend}. Nothing is emailed from this list.</p>
      <article className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-xs font-bold uppercase tracking-wide text-[#C2410C]">Draft</div>
        <h2 className="text-lg font-bold">0010016 · Fixture client</h2>
        <p className="text-sm">R76 426,79 incl. VAT</p>
        <button type="button" className="mt-3 min-h-[44px] w-full rounded-[10px] bg-[#C2410C] font-bold text-white" onClick={() => setOpen(true)}>Preview &amp; email to client</button>
      </article>
      {open && (
        <div role="dialog" aria-label="Check before sending" className="rounded-2xl border bg-white p-4 shadow-lg" data-testid="fixture-send-dialog">
          <h2 className="text-lg font-extrabold">Check before sending</h2>
          <p className="mt-2 text-sm">To: fixture.client@example.com</p>
          <p className="text-sm">Subject: Invoice 0010016</p>
          <p className="mt-2 text-xs text-[#4e6d86]">Nothing is sent until you press Send.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-[44px] flex-1 rounded-[10px] border font-bold" onClick={() => setOpen(false)}>Edit</button>
            <button type="button" className="min-h-[44px] flex-1 rounded-[10px] bg-[#9A3412] font-bold text-white" onClick={() => setSent(true)}>Send</button>
          </div>
          {sent && <p className="mt-2 text-sm font-semibold" data-testid="fixture-not-sent">Fixture only. No invoice was emailed.</p>}
        </div>
      )}
    </div>
  );
}

export default function AdminHomePreviewFixture() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const view = sp.get("view") || "home";
  const withJob = sp.get("jobs") === "1";
  const [sheet, setSheet] = useState(false);
  const [createOpen, setCreateOpen] = useState(sp.get("new") === "1");
  const home = (
    <AdminHomeScreen
      eyebrow="SATURDAY, 07 NOV"
      title="Good afternoon, Johan"
      invoice={{ count: counts.waiting.count, total: "R76 426,79" }}
      crew={withJob ? [{ id: "fixture-job", href: "/dev/admin-home?view=jobs", who: "Tech A", type: "Installation", where: "Claremont", client: "Fixture client" }] : []}
      levels={[{ key: "cu", name: "Copper pipe", detail: "12 in stock · 6 m needed this week", short: null, href: "/dev/admin-home?view=stock" }]}
      orders={[]}
      slices={cashProjectionSlices(counts)}
      money={[fixtureMoney.cash, fixtureMoney.liabilities, fixtureMoney.deposits, fixtureMoney.finals]}
      onSlice={(s) => navigate(s.key === "waiting" ? "/dev/admin-home?view=review" : "/dev/admin-home?view=invoices")}
      onSliceInfo={() => setSheet(true)}
      onReview={() => navigate("/dev/admin-home?view=review")}
      onInvoice={() => setSheet(true)}
      jobsHref="/dev/admin-home?view=jobs"
      bookHref="/dev/admin-home?view=jobs&new=1"
      mapHref="/dev/admin-home?view=map"
      stockHref="/dev/admin-home?view=stock"
    />
  );
  let body = home;
  if (view === "review" || view === "invoices") body = <ReviewFixture preview={sp.get("preview") === "1"} />;
  else if (view === "jobs") {
    body = (
      <div data-testid="fixture-jobs">
        <Banner />
        <JobsCalmView
          tab="today" onTab={() => {}} dateLabel="Sat 7 Nov" onNew={() => setCreateOpen(true)}
          leads={[]} leadsTotal={0} showAllLeads={false} onShowAll={() => {}}
          people={[{ id: "tech", name: "Tech A", role: "Tech", dot: "green" }]}
          blocks={[{ id: "fixture-job", kind: "job", personId: "tech", day: "2026-11-07", start: 9 * 60, dur: 180, title: "Installation · Fixture client", place: "Claremont", block: "install" }]}
          unassigned={[]}
          weekDays={[]} everyone="all" everyoneOptions={[{ value: "all", label: "Everyone ▾" }]} onEveryone={() => {}}
          chip={null} onChip={() => {}} counts={{ leadsNotContacted: 0, late: 0, unassigned: 0 }}
          onCallLead={() => {}} onAssignLead={() => {}} onOpenLead={() => {}}
          onAssignJob={() => {}} onOpenJob={() => setCreateOpen(true)} onOpenBlock={() => setCreateOpen(true)}
        />
        {createOpen && (
          <div role="dialog" aria-label="Create New Job" className="fixed inset-x-3 bottom-20 z-50 rounded-2xl bg-white p-4 shadow-xl" data-testid="fixture-create-job">
            <h2 className="text-lg font-extrabold">Create New Job</h2>
            <p className="mt-1 text-sm text-[#4e6d86]">Live app opens the booking form (customer, time, technician). This fixture does not save a job.</p>
            <label className="mt-3 block text-sm font-semibold">Title<input className="mt-1 w-full rounded-lg border px-3 py-2" defaultValue="Saturday installation" /></label>
            <label className="mt-2 block text-sm font-semibold">Date<input className="mt-1 w-full rounded-lg border px-3 py-2" type="date" defaultValue="2026-11-07" /></label>
            <button type="button" className="mt-3 min-h-[44px] w-full rounded-[10px] bg-[#C2410C] font-bold text-white" onClick={() => setCreateOpen(false)}>Close · nothing saved</button>
          </div>
        )}
      </div>
    );
  } else if (view === "map") {
    body = (
      <div className="p-3 pb-24">
        <Banner />
        <h1 className="text-2xl font-extrabold">Who is where</h1>
        <p className="mt-2 text-sm">Live app opens {ADMIN_HOME_ROUTES.map}. The streets map is the real Mapbox screen for admin.</p>
      </div>
    );
  } else if (view === "stock") {
    body = (
      <div className="p-3 pb-24" data-testid="fixture-stock">
        <Banner />
        <h1 className="text-2xl font-extrabold">Stock</h1>
        <p className="mt-2 text-sm">Live app opens {ADMIN_HOME_ROUTES.stock}. Stock on hand, stock-take, and what this week’s jobs still need.</p>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 390, margin: "0 auto", minHeight: "100vh", background: "#e9eef3" }} data-testid="admin-home-fixture">
      {view === "home" ? (
        <RoleMapFrame map={false}>
          <Banner />
          {body}
        </RoleMapFrame>
      ) : body}
      {sheet && <HowCountedSheet figure={counts.waiting} onClose={() => setSheet(false)} />}
      <Tabs view={view === "invoices" ? "review" : view} />
    </div>
  );
}
