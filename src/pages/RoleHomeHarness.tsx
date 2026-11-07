/** Dev-only shots of the approved role homes. Numbers here are harness rows, not Massair CT. */
import { useSearchParams } from "react-router-dom";
import { buildMaterialCheck, type SourceLine, type StockHand } from "@/lib/materialCheck";
import { buildYardHome, type YardJob } from "@/lib/yardView";
import RoleMapFrame from "@/components/v8/roleHome/RoleMapFrame";
import { AdminHomeScreen, SalesHomeScreen, SalesJobScreen, TechHomeScreen, TechJobScreen } from "@/components/v8/roleHome/screens";

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
const harnessJob = (over: Partial<YardJob> & { id: string }): YardJob => ({
  company_id: DEMO, status: "scheduled", title: "Install", job_type: "installation", customer_name: "Demo client", ...over,
});
const yard = buildYardHome({
  companyId: DEMO,
  now: HARNESS_NOW,
  invoices: [
    { id: "w", company_id: DEMO, status: "draft", grand_total: 1500, invoice_number: "DEMO-1", customer_name: "Harness client" },
    { id: "d1", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 8000, notes: "DEPOSIT", invoice_number: "DEMO-D1", customer_name: "Demo client A", expected_deposit_date: "2026-11-12" },
    { id: "d2", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 4500, notes: "DEPOSIT", invoice_number: "DEMO-D2", customer_name: "Demo client B", expected_deposit_date: "2026-11-19" },
    { id: "f", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 22000, notes: "Final", invoice_number: "DEMO-F", customer_name: "Demo client C", expected_final_date: "2026-11-28" },
  ],
  jobs: [
    harnessJob({ id: "leave-1", customer_name: "Demo client A", scheduled_for: "2026-11-07T06:30:00+02:00", assignee_name: "Tech A" }),
    harnessJob({ id: "leave-2", customer_name: "Demo client B", scheduled_for: "2026-11-07T08:00:00+02:00", assignee_name: "Tech B", job_type: "service", title: "Service" }),
    harnessJob({ id: "road-1", customer_name: "Demo client C", status: "dispatched", en_route_at: "2026-11-07T07:10:00+02:00", scheduled_for: "2026-11-07T07:00:00+02:00", assignee_name: "Tech A" }),
    harnessJob({ id: "done-1", customer_name: "Demo client D", status: "completed", completed_at: "2026-11-07T09:00:00+02:00", scheduled_for: "2026-11-07T05:00:00+02:00", assignee_name: "Tech B" }),
  ],
  leads: [
    { id: "n1", company_id: DEMO, status: "pending", customer_name: "New demo", primary_intent: "sales" },
    { id: "n2", company_id: DEMO, status: "pending", customer_name: "New demo 2", primary_intent: "sales" },
  ],
  quotes: [
    { id: "qd", company_id: DEMO, status: "draft", total: 1000, created_at: "2026-11-01", customer_name: "Draft demo", quote_number: "D-1" },
    { id: "qs", company_id: DEMO, status: "sent", total: 2000, created_at: "2026-11-01", sent_at: "2026-11-02", customer_name: "Sent demo", quote_number: "S-1" },
  ],
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
      <small style={{ fontWeight: 400, fontSize: 10 }}>Demo · harness, not live Massair CT totals</small>
    </header>
  );
}

function Side({ items }: { items: string[] }) {
  return (
    <aside style={{ width: 156, flexShrink: 0, background: "rgba(255,255,255,.94)", padding: "16px 8px", borderRight: "1px solid rgba(150,190,220,.55)" }}>
      <div style={{ fontWeight: 800, padding: "4px 10px 18px" }}>Field Lynk<small style={{ display: "block", letterSpacing: 1.5, fontSize: 9, color: "#64758b" }}>SYNC</small></div>
      {items.map((label, i) => (
        <div key={label} style={{ padding: "12px 10px", borderRadius: 13, marginBottom: 7, background: i === 0 ? "linear-gradient(105deg,#e8f7ff,#d9effe)" : "transparent", color: i === 0 ? "#0785d7" : "#445775", fontSize: 13 }}>{label}</div>
      ))}
    </aside>
  );
}

export default function RoleHomeHarness() {
  const [sp] = useSearchParams();
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
  } else {
    body = (
      <AdminHomeScreen
        eyebrow="SATURDAY, 07 NOV"
        title="Good morning"
        companyName="Demo company (Pty) Ltd"
        invoice={yard.invoice}
        model={yard}
        onReview={() => undefined}
        onInvoice={() => undefined}
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
