/** Dev-only shots of the approved role homes. Numbers here are harness rows, not Massair CT. */
import { useNavigate, useSearchParams } from "react-router-dom";
import { countAdminHome } from "@/lib/adminHomeCount";
import { ADMIN_HOME_ROUTES, cashProjectionSlices } from "@/lib/roleHome";
import { buildMaterialCheck, type SourceLine, type StockHand } from "@/lib/materialCheck";
import { buildYardHome, type YardJob } from "@/lib/yardView";
import RoleMapFrame from "@/components/v8/roleHome/RoleMapFrame";
import { AdminHomeScreen, SalesHomeScreen, SalesJobScreen, TechHomeScreen, TechJobScreen, YardViewScreen } from "@/components/v8/roleHome/screens";

const DEMO = "00000000-0000-4000-8000-0000000000aa";
const hand = (id: string, label: string, qty: number, productId: string): StockHand => ({ id, label, qty, productId });
const line = (over: Partial<SourceLine> & { id: string }): SourceLine => ({ source: "quote", quantity: 1, ...over });

const install = buildMaterialCheck({
  kind: "installation",
  stockKnown: true,
  lines: [
    line({ id: "cu", name: "Copper pipe", lengthM: 6, productId: "p-cu" }),
    line({ id: "br", name: "Wall brackets", quantity: 1, productId: "p-br" }),
    line({ id: "in", name: "Indoor cassette", productType: "ac_unit", quantity: 1, productId: "p-in" }),
    line({ id: "out", name: "Outdoor unit", code: "RXM35", productType: "ac_unit", quantity: 1, productId: "p-out" }),
  ],
  stock: [
    hand("s-cu", "Copper pipe", 12, "p-cu"),
    hand("s-br", "Wall brackets", 4, "p-br"),
    hand("s-in", "Indoor cassette", 0, "p-in"),
    hand("s-out", "Outdoor unit", 0, "p-out"),
  ],
});

const service = buildMaterialCheck({
  kind: "service",
  stockKnown: true,
  lines: [
    line({ id: "unit", name: "Indoor cassette", productType: "ac_unit", quantity: 1, productId: "p-in" }),
    line({ id: "cu", name: "Copper pipe", lengthM: 18, productId: "p-cu" }),
    line({ id: "br", name: "Wall brackets", quantity: 1, productId: "p-br" }),
  ],
  stock: [hand("s-in", "Indoor cassette", 3, "p-in")],
});

const HARNESS_NOW = new Date("2026-11-07T08:00:00+02:00");
const harnessInvoices = [
  { id: "w", company_id: DEMO, status: "draft", grand_total: 1500, invoice_number: "DEMO-1", customer_name: "Harness client" },
  { id: "d1", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 8000, notes: "DEPOSIT", invoice_number: "DEMO-D1", customer_name: "Demo client A", expected_deposit_date: "2026-11-12" },
  { id: "d2", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 4500, notes: "DEPOSIT", invoice_number: "DEMO-D2", customer_name: "Demo client B", expected_deposit_date: "2026-11-19" },
  { id: "f", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 22000, notes: "Final", invoice_number: "DEMO-F", customer_name: "Demo client C", expected_final_date: "2026-11-28" },
];
const harnessCounts = countAdminHome({ companyId: DEMO, now: HARNESS_NOW, invoices: harnessInvoices });
const harnessJob = (over: Partial<YardJob> & { id: string }): YardJob => ({
  company_id: DEMO, status: "scheduled", title: "Install", job_type: "installation", customer_name: "Demo client", ...over,
});
const yard = buildYardHome({
  companyId: DEMO,
  now: HARNESS_NOW,
  invoices: harnessInvoices,
  jobs: [
    harnessJob({ id: "leave-1", customer_name: "Demo client A", scheduled_for: "2026-11-07T06:30:00+02:00", assignee_name: "Tech A", address: "24 Demo Lane, Claremont" }),
    harnessJob({ id: "leave-2", customer_name: "Demo client B", scheduled_for: "2026-11-07T08:00:00+02:00", assignee_name: "Tech B", job_type: "service", title: "Service", address: "1 Demo Road, Observatory" }),
    harnessJob({ id: "road-1", customer_name: "Demo client C", status: "dispatched", en_route_at: "2026-11-07T07:10:00+02:00", scheduled_for: "2026-11-07T07:00:00+02:00", assignee_name: "Tech A", address: "8 Demo Street, Sea Point" }),
    harnessJob({ id: "done-1", customer_name: "Demo client D", status: "completed", completed_at: "2026-11-07T09:00:00+02:00", scheduled_for: "2026-11-07T05:00:00+02:00", assignee_name: "Tech B", address: "3 Demo Avenue, Wynberg" }),
  ],
  leads: [
    { id: "n1", company_id: DEMO, status: "pending", customer_name: "Demo Client 1", primary_intent: "sales", service_type: "installation" },
    { id: "n2", company_id: DEMO, status: "pending", customer_name: "Demo Client 2", primary_intent: "sales", service_type: "service" },
  ],
  quotes: [
    { id: "qd", company_id: DEMO, status: "draft", total: 1000, created_at: "2026-11-01", customer_name: "Demo Client 3", quote_number: "D-1", lead_id: "lead-3" },
    { id: "qs", company_id: DEMO, status: "sent", total: 2000, created_at: "2026-11-01", sent_at: "2026-11-02", customer_name: "Demo Client 4", quote_number: "S-1", lead_id: "lead-4" },
  ],
  leadService: { "lead-3": "installation", "lead-4": "repair" },
  bankState: "ready",
  bank: {
    accounts: [{ id: "a", label: "Demo current", account_ref: null, include: true, sort: 1 }],
    balances: [{ id: "b", account_id: "a", balance: 12500, as_of: "2026-11-03", created_at: "2026-11-03T08:00:00Z" }],
  },
  booksState: "ready",
  books: { receipts: [], commitments: [], allocations: [] },
});

const SALES_NAV = ["Home", "Pipeline", "Quotes", "Schedule", "Clients"];
const ADMIN_NAV = ["Home", "Jobs", "Invoices", "Stock", "Schedule"];

function Bar({ title }: { title: string }) {
  return (
    <header style={{ height: 50, background: "#3D9BEB", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", fontWeight: 700 }}>
      <b>{title}</b>
      <small style={{ fontWeight: 600, fontSize: 11 }}>Demo - harness, not live Massair CT totals</small>
    </header>
  );
}

function Side({ items }: { items: string[] }) {
  return (
    <aside className="v8-richer-halo v8-role-side" data-testid="role-side" aria-label="Side menu" style={{ position: "sticky", top: 0, height: "calc(100vh - 50px)", alignSelf: "flex-start" }}>
      <div className="v8-mark">Field Lynk</div>
      <div className="v8-mark-sync">SYNC</div>
      <nav aria-label="Main">
        {items.map((label, i) => (
          <div key={label} className={i === 0 ? "v8-side-item is-active" : "v8-side-item"} aria-current={i === 0 ? "page" : undefined}>{label}</div>
        ))}
      </nav>
    </aside>
  );
}

export default function RoleHomeHarness() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const view = sp.get("view") || "tech-home";
  const tablet = view.endsWith("tablet");
  const phone = !tablet;
  let body = null;
  let title = "Home";
  if (view === "tech-home") {
    body = (
      <TechHomeScreen eyebrow="SATURDAY, 07 NOV" title="Good morning, Tech A" jobs={[
        { id: "a", href: "/dev/role-homes?view=tech-service", time: "08:30", type: "Service", area: "Observatory", client: "Demo Client 4", check: service },
        { id: "b", href: "/dev/role-homes?view=tech-job", time: "12:00", type: "Installation", area: "Claremont", client: "Demo Client 7", check: install },
        { id: "c", href: "/dev/role-homes?view=tech-service", time: "15:00", type: "Service", area: "Wynberg", client: "Demo Client 3", check: service },
      ]} />
    );
  } else if (view === "tech-job") {
    title = "Job";
    body = (
      <TechJobScreen type="Installation" client="Demo Client 7" area="Claremont" when="12:00" duration="About 3 hours" phone="021 000 0000 · demo number" address="24 Demo Lane, Claremont" navHref="#navigate" check={install} description="Install the indoor cassette and outdoor unit. Run copper pipe along the agreed route and test cooling." onLogParts={() => undefined} onComplete={() => undefined} />
    );
  } else if (view === "tech-service") {
    title = "Job";
    body = (
      <TechJobScreen type="Service" client="Demo Client 4" area="Observatory" when="08:30" duration="About 1 hour" phone="021 000 0001 · demo number" address="1 Demo Road, Observatory" navHref="#navigate" check={service} description="Repair visit. Consumables such as refrigerant. No new-unit pack." onLogParts={() => undefined} onComplete={() => undefined} />
    );
  } else if (view === "sales-home" || view === "sales-tablet") {
    body = (
      <SalesHomeScreen eyebrow="SATURDAY, 07 NOV" title="Good morning" appointments={[
        { id: "1", href: "/dev/role-homes?view=sales-home", time: "09:00", type: "Quote visit", place: "Newlands · Demo Client 4", chip: { label: "No technician yet", tone: "neutral" } },
        { id: "2", href: "/dev/role-homes?view=sales-home", time: "14:00", type: "Follow-up", place: "Rondebosch · Demo Client 3", chip: null },
      ]} booked={[
        { id: "j1", href: "/dev/role-homes?view=sales-job", when: "Tue", type: "Installation", client: "Demo Client 7", area: "Claremont", tech: "Tech A" },
        { id: "j2", href: "/dev/role-homes?view=sales-job", when: "Wed", type: "Service", client: "Demo Client 4", area: "Observatory", tech: "Tech B" },
        { id: "j3", href: "/dev/role-homes?view=sales-job", when: "Thu", type: "Installation", client: "Demo Client 3", area: "Wynberg", tech: "Tech A" },
        { id: "j4", href: "/dev/role-homes?view=sales-job", when: "Fri", type: "Service", client: "Demo Client 7", area: "Rondebosch", tech: "Tech B" },
      ]} />
    );
  } else if (view === "sales-job") {
    title = "Job";
    body = (
      <SalesJobScreen type="Installation" client="Demo Client 7" area="Claremont" when="Tue, 10 Nov · 12:00" duration="About 3 hours" tech="Tech A" phone="021 000 0000 · demo number" address="24 Demo Lane, Claremont, Cape Town · example address" navHref="#navigate" check={install} quoteHref="/dev/role-homes?view=sales-job" description="Install the indoor cassette and outdoor unit. Run copper pipe along the agreed route and test cooling." />
    );
  } else if (view === "admin-yard" || view === "admin-yard-tablet") {
    title = "Yard";
    body = (
      <YardViewScreen
        eyebrow="SATURDAY, 07 NOV"
        title="Good morning"
        companyName="Demo company (Pty) Ltd"
        invoice={yard.invoice.count > 0 ? yard.invoice : null}
        model={yard}
        onReview={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
        onInvoice={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
      />
    );
  } else {
    body = (
      <AdminHomeScreen
        eyebrow="SATURDAY, 07 NOV"
        title="Good afternoon, Johan"
        companyName="Demo company (Pty) Ltd"
        invoice={yard.invoice.count > 0 ? yard.invoice : null}
        model={yard}
        crew={[
          { id: "1", href: "/admin/jobs/demo-1", who: "Tech A", type: "Installation", where: "Claremont", client: "Demo Client 7" },
          { id: "2", href: "/admin/jobs/demo-2", who: "Tech B", type: "Service", where: "Observatory", client: "Demo Client 4" },
        ]}
        levels={[
          { key: "in", name: "Indoor cassettes", detail: "0 in stock · 1 needed this week", short: 1, href: ADMIN_HOME_ROUTES.stock },
          { key: "cu", name: "Copper pipe", detail: "12 in stock · 6 m needed this week", short: null, href: ADMIN_HOME_ROUTES.stock },
        ]}
        orders={[
          { key: "in", label: "1 × Indoor cassette", detail: "For booked installations", href: ADMIN_HOME_ROUTES.stock },
          { key: "out", label: "1 × Outdoor unit", detail: "For booked installations", href: ADMIN_HOME_ROUTES.stock },
        ]}
        slices={cashProjectionSlices(harnessCounts)}
        onSlice={(s) => navigate(s.figure.actionHref)}
        onSliceInfo={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
        onReview={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
        onInvoice={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
      />
    );
  }
  return (
    <div style={{ minHeight: "100vh", background: "#e9e7e4" }} data-testid={`harness-${view}`}>
      <Bar title={title} />
      <div style={{ display: "flex", minHeight: "calc(100vh - 50px)" }}>
        {tablet && <Side items={view.startsWith("admin") ? ADMIN_NAV : SALES_NAV} />}
        <div style={{ flex: 1, minWidth: 0, maxWidth: phone ? 430 : undefined, margin: phone ? "0 auto" : undefined }}>
          <RoleMapFrame map={sp.get("map") === "1"}>{body}</RoleMapFrame>
        </div>
      </div>
    </div>
  );
}
