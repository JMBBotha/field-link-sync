/** Dev-only shots of the approved role homes. Numbers here are harness rows, not Massair CT. */
import { useSearchParams } from "react-router-dom";
import { countAdminHome } from "@/lib/adminHomeCount";
import { buildMaterialCheck, type SourceLine, type StockHand } from "@/lib/materialCheck";
import { cashProjectionSlices } from "@/lib/roleHome";
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

const counts = countAdminHome({
  companyId: DEMO,
  now: new Date("2026-11-07T08:00:00+02:00"),
  invoices: [
    { id: "w", company_id: DEMO, status: "draft", grand_total: 1500, invoice_number: "DEMO-1", customer_name: "Harness client" },
    { id: "d", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 800, notes: "DEPOSIT", invoice_number: "DEMO-D", customer_name: "Harness client" },
    { id: "f", company_id: DEMO, status: "sent", sent_at: "2026-11-01", grand_total: 2200, notes: "Final", invoice_number: "DEMO-F", customer_name: "Harness client" },
  ],
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
    <aside className="v8-richer-halo v8-role-side" data-testid="role-side" aria-label="Side menu">
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
        invoice={{ count: counts.waiting.count, total: "R1 500,00" }}
        crew={[
          { id: "1", href: "/dev/role-homes?view=admin-home", who: "Tech A", type: "Installation", where: "Claremont", client: "Demo Client 7" },
          { id: "2", href: "/dev/role-homes?view=admin-home", who: "Tech B", type: "Service", where: "Observatory", client: "Demo Client 4" },
        ]}
        levels={[
          { key: "in", name: "Indoor cassettes", detail: "0 in stock · 1 needed this week", short: 1, href: "/dev/role-homes?view=admin-home" },
          { key: "cu", name: "Copper pipe", detail: "12 in stock · 6 m needed this week", short: null, href: "/dev/role-homes?view=admin-home" },
        ]}
        orders={[
          { key: "in", label: "1 × Indoor cassette", detail: "For booked installations", href: "/dev/role-homes?view=admin-home" },
          { key: "out", label: "1 × Outdoor unit", detail: "For booked installations", href: "/dev/role-homes?view=admin-home" },
        ]}
        slices={cashProjectionSlices(counts)}
        onSlice={() => undefined}
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
