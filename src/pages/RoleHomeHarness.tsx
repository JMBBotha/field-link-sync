/** Dev-only shots of the approved role homes. Numbers here are harness rows, not Massair CT. */
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { countAdminHome } from "@/lib/adminHomeCount";
import { ADMIN_HOME_ROUTES, cashProjectionSlices } from "@/lib/roleHome";
import { buildMaterialCheck, type SourceLine, type StockHand } from "@/lib/materialCheck";
import { buildYardHome, type YardJob } from "@/lib/yardView";
import RoleMapFrame from "@/components/v8/roleHome/RoleMapFrame";
import { OpenLeadsCard } from "@/components/v8/roleHome/OpenLeadsCard";
import { AdminHomeScreen, SalesHomeScreen, SalesJobScreen, TechHomeScreen, TechJobScreen, YardViewScreen } from "@/components/v8/roleHome/screens";
import { MaterialsDesk } from "@/components/stock/MaterialsDesk";
import NewAdminHeader from "@/components/admin/NewAdminHeader";
import CompanyLogo from "@/components/shared/CompanyLogo";
import { V8_HEADER_LOGO_CLASS, V8_HEADER_ROW_CLASS } from "@/components/shared/v8HeaderLogo";

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

/** Johan's 17 Nov phone: overdue finals were hidden inside Next 7 days and Next 30 days. */
const SHOT_NOW = new Date("2026-11-17T08:04:00+02:00");
const shotFinals = [
  { id: "f1", total: 200000, date: "2026-11-09", name: "Raymond Kark", number: "FIN-9" },
  { id: "f2", total: 150000, date: "2026-11-10", name: "Harbour House", number: "FIN-10" },
  { id: "f3", total: 100000, date: "2026-11-16", name: "Sea Point", number: "FIN-16" },
  { id: "f4", total: 63036, date: "2026-11-01", name: "Claremont", number: "FIN-1" },
];
const shotYard = buildYardHome({
  companyId: DEMO,
  now: SHOT_NOW,
  invoices: [
    { id: "draft-shot", company_id: DEMO, status: "draft", grand_total: 400, invoice_number: "INV-400", customer_name: "Raymond Kark" },
    ...shotFinals.map((row) => ({
      id: row.id, company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: row.total, notes: "Final",
      invoice_number: row.number, customer_name: row.name, expected_final_date: row.date,
    })),
  ],
  jobs: [3, 4, 5, 10].map((day) => harnessJob({
    id: `shot-${day}`, customer_name: "Demo client", scheduled_for: `2026-11-${String(day).padStart(2, "0")}T08:00:00+02:00`, job_type: "installation",
  })),
  leads: Array.from({ length: 17 }, (_, i) => ({
    id: `shot-lead-${i + 1}`, company_id: DEMO, status: "pending", customer_name: `Open lead ${i + 1}`, primary_intent: "sales", service_type: "installation",
  })),
  bankState: "ready" as const,
  bank: {
    accounts: [{ id: "fnb", label: "FNB Business", account_ref: "…563591", include: true, sort: 1 }],
    balances: [{ id: "bal", account_id: "fnb", balance: 38, as_of: "2026-11-16", created_at: "2026-11-16T08:00:00Z", source: "walda" as const }],
  },
  booksState: "ready" as const,
  books: {
    receipts: [{
      id: "dep-in", source: "field_lynk" as const, invoice_id: "dep-in", quote_id: null, ref: "DEP", client: "Raymond Kark",
      part: "deposit" as const, amount_incl: 1000, vat_incl: 0, expected_date: null, leeway_days: 0, confidence: 100,
      status: "received" as const, received_date: "2026-11-01", note: null,
    }],
    commitments: [
      { id: "c1", source_key: null, invoice_id: "dep-in", quote_id: null, job_id: "job-1", project: "JOB Raymond", item: "Outdoor unit", kind: "unit" as const, qty: 1, supplier: "Samsung", unit_cost_excl: 400000, vat_rate: 0, status: "needed" as const, pay_date: "2026-11-09", note: null },
      { id: "c2", source_key: null, invoice_id: "dep-in", quote_id: null, job_id: "job-1", project: "JOB Raymond", item: "Copper", kind: "material" as const, qty: 1, supplier: "One Stop", unit_cost_excl: 165711, vat_rate: 0, status: "needed" as const, pay_date: "2026-11-16", note: null },
    ],
    allocations: [],
  },
});

const leadsYard = buildYardHome({
  companyId: DEMO,
  now: HARNESS_NOW,
  invoices: harnessInvoices,
  quotes: [
    { id: "old", company_id: DEMO, status: "draft", total: 76427, created_at: "2026-08-01T08:00:00+02:00", updated_at: "2026-08-20T08:00:00+02:00", customer_name: "CAPE ESTATES PAARL (Pty) Ltd", quote_number: "0000086" },
    { id: "newq", company_id: DEMO, status: "draft", total: 991005, created_at: "2026-11-01T08:00:00+02:00", updated_at: "2026-11-02T08:00:00+02:00", customer_name: "Built Construction Solutions (Pty) Ltd", quote_number: "Q-2026-0043" },
  ],
  leads: [
    { id: "n1", company_id: DEMO, status: "pending", customer_name: "New enquiry", primary_intent: "sales", service_type: "installation", created_at: "2026-11-06T08:00:00+02:00" },
  ],
  bankState: "ready",
  bank: { accounts: [], balances: [] },
  booksState: "ready",
  books: { receipts: [], commitments: [], allocations: [] },
});

const SALES_NAV = ["Home", "Pipeline", "Quotes", "Schedule", "Clients"];
const ADMIN_NAV = ["Home", "Jobs", "Invoices", "Stock", "Schedule"];

function Bar({ title, tech, dark }: { title: string; tech: boolean; dark: boolean }) {
  const note = <p style={{ margin: 0, padding: "4px 12px", background: "#0F1B2A", color: "#fff", fontSize: 11, fontWeight: 600 }}>Demo - harness, not live Massair CT totals</p>;
  if (tech) {
    return (
      <div>
        <header data-testid="v8-field-top-bar" className="v8-bar-hdr v8-bar-over-halo shrink-0 border-b" style={{ background: "#3D9BEB", color: "#fff" }}>
          <div className={V8_HEADER_ROW_CLASS}>
            <CompanyLogo data-testid="header-logo" className={V8_HEADER_LOGO_CLASS} />
          </div>
        </header>
        {note}
      </div>
    );
  }
  return (
    <div>
      <NewAdminHeader pageTitle={title} onMenu={() => undefined} onSearch={() => undefined} onCreateLead={() => undefined} resolvedTheme={dark ? "dark" : "light"} toggleTheme={() => undefined} />
      {note}
    </div>
  );
}

function Side({ items }: { items: string[] }) {
  return (
    <aside className="v8-richer-halo v8-role-side" data-testid="role-side" aria-label="Side menu" style={{ position: "sticky", top: 0, alignSelf: "stretch" }}>
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
  const dark = sp.get("theme") === "dark";
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  const view = sp.get("view") || "tech-home";
  const tablet = view.endsWith("tablet");
  const phone = !tablet;
  let body = null;
  let title = "Home";
  if (view === "tech-home" || view === "tech-home-tablet") {
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
  } else if (view === "admin-leads" || view === "admin-leads-tablet") {
    title = "Open leads";
    body = (
      <div style={{ padding: 16 }}>
        <OpenLeadsCard
          rows={leadsYard.openLeadRows}
          warnDays={30}
          actions={{
            forceMenuId: sp.get("menu") === "1" ? "quote:old" : null,
            canArchive: () => true,
            initialSelected: sp.get("select") === "1" || sp.get("review") === "1" ? ["quote:old", "quote:newq"] : undefined,
            previewReview: sp.get("review") === "1" ? [
              { id: "quote:old", customer: "CAPE ESTATES PAARL (Pty) Ltd", quoteRef: "0000086", amountLabel: "R76 427", email: null, phone: "021 000 0000", quoteId: "old", customerId: "c1", block: "No email — sending uses email" },
              { id: "quote:newq", customer: "Built Construction Solutions (Pty) Ltd", quoteRef: "Q-2026-0043", amountLabel: "R991 005", email: "built@example.com", phone: "082 000 0000", quoteId: "newq", customerId: "c2", block: null },
            ] : undefined,
          }}
        />
      </div>
    );
  } else if (view === "admin-stock" || view === "admin-stock-tablet") {
    title = "Stock";
    body = (
      <div style={{ padding: 12 }}>
        <MaterialsDesk
          totalLabel="R71 000"
          lines={[
            { label: "Cabling", detail: "120 m on hand", valueLabel: "R26 000" },
            { label: "Copper pipe", detail: "80 m on hand", valueLabel: "R25 000" },
            { label: "Aluminium pipe and lagging", detail: "40 m on hand", valueLabel: "R20 000" },
          ]}
          intakes={[
            { id: "cu", kind: "material_purchase", title: "One Stop · CU-19", meta: "3 Nov · unpaid", amountLabel: "R25 600" },
            { id: "cn", kind: "return", title: "One Stop · CN-1", meta: "Credit · copper pipe", amountLabel: "R2 560" },
            { id: "dd", kind: "direct_delivery", title: "RKP · 21217", meta: "Client paid the supplier · not stock", amountLabel: "—" },
          ]}
          averages={[{ id: "cu", label: "Copper pipe", per: "install", qty: "12", unit: "m" }]}
          onBuy={async () => undefined}
          onUsed={async () => undefined}
          onSaveAverage={async () => undefined}
          onDeleteAverage={async () => undefined}
        />
      </div>
    );
  } else if (view === "admin-archived" || view === "admin-archived-tablet") {
    title = "Quotes";
    body = (
      <div style={{ padding: 16 }} data-testid="archived-quotes-harness">
        <div className="rh-card" style={{ background: "rgba(255,255,255,.86)", padding: 16, borderRadius: 19 }}>
          <div className="rh-head">
            <h2>Quotes</h2>
            <span className="rh-count">1</span>
          </div>
          <div style={{ display: "flex", gap: 6, margin: "8px 0 4px", flexWrap: "wrap" }}>
            {["All", "Draft", "Sent", "Archived"].map((label) => (
              <span key={label} data-testid={label === "Archived" ? "quotes-status-archived" : undefined} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d6e4ef", fontSize: 12, fontWeight: 700, background: label === "Archived" ? "#14324d" : "#fff", color: label === "Archived" ? "#fff" : "#1d3a54" }}>{label}</span>
            ))}
          </div>
          <p className="rh-muted">Same Archived filter as Quotes. Unarchive puts the quote back on Open leads.</p>
          <div className="rh-row" data-testid="archived-quote-row">
            <div>
              <b>CAPE ESTATES PAARL (Pty) Ltd</b>
              <div className="rh-muted">0000086 · R76 427</div>
              <div className="rh-muted">Archived · No activity for 30 days</div>
            </div>
            <button type="button" className="open-lead-quick" style={{ display: "inline-flex" }} data-testid="archived-unarchive">Unarchive</button>
          </div>
        </div>
      </div>
    );
  } else {
    const shot = sp.get("money") === "shot";
    const home = shot ? shotYard : yard;
    body = (
      <AdminHomeScreen
        eyebrow={shot ? "TUESDAY, 17 NOV" : "SATURDAY, 07 NOV"}
        title="Good afternoon, Johan"
        companyName="Demo company (Pty) Ltd"
        invoice={home.invoice.count > 0 ? home.invoice : null}
        model={home}
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
        poolOnHand="R71 000"
        expectOpen={sp.get("expect") === "1"}
        invoices={[{ id: "d1", label: "DEMO-D1 · Demo client A" }]}
        onAddExpected={async () => undefined}
        onExpectedStatus={async () => undefined}
        onSlice={(s) => navigate(s.figure.actionHref)}
        onSliceInfo={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
        onReview={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
        onInvoice={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
      />
    );
  }
  return (
    <div style={{ minHeight: "100vh", background: "#e9e7e4" }} data-testid={`harness-${view}`}>
      <Bar title={title} tech={view.startsWith("tech")} dark={dark} />
      <div style={{ display: "flex", minHeight: "calc(100vh - 4.5rem)" }}>
        {tablet && <Side items={view.startsWith("admin") ? ADMIN_NAV : view.startsWith("tech") ? ["Today", "Schedule", "Earnings"] : SALES_NAV} />}
        <div style={{ flex: 1, minWidth: 0, maxWidth: phone ? 430 : undefined, margin: phone ? "0 auto" : undefined }}>
          <RoleMapFrame map={sp.get("map") === "1"}>{body}</RoleMapFrame>
        </div>
      </div>
    </div>
  );
}
