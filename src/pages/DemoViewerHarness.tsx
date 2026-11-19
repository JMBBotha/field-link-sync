/** Designer preview. Numbers and names are fake. Not Massair CT. */
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { countAdminHome } from "@/lib/adminHomeCount";
import { ADMIN_HOME_ROUTES, cashProjectionSlices } from "@/lib/roleHome";
import { buildMaterialCheck, type SourceLine, type StockHand } from "@/lib/materialCheck";
import { buildYardHome, type YardJob } from "@/lib/yardView";
import RoleMapFrame from "@/components/v8/roleHome/RoleMapFrame";
import { OpenLeadsCard } from "@/components/v8/roleHome/OpenLeadsCard";
import { AdminHomeScreen, TechJobScreen } from "@/components/v8/roleHome/screens";
import { ExpectedFinalPaymentField } from "@/components/invoicing/ExpectedFinalPaymentField";
import { DEMO_UX_COMPANY_ID, DEMO_UX_COMPANY_NAME } from "@/lib/demoViewer";

const CO = DEMO_UX_COMPANY_ID;
const NOW = new Date("2026-11-19T10:00:00+02:00");
const hand = (id: string, label: string, qty: number, productId: string): StockHand => ({ id, label, qty, productId });
const line = (over: Partial<SourceLine> & { id: string }): SourceLine => ({ source: "quote", quantity: 1, ...over });
const install = buildMaterialCheck({
  kind: "installation",
  stockKnown: true,
  lines: [
    line({ id: "in", name: "Midwall split 12000 BTU (FAKE)", productType: "ac_unit", quantity: 1, productId: "p-in" }),
    line({ id: "cu", name: "Copper and trunking (FAKE)", lengthM: 6, productId: "p-cu" }),
  ],
  stock: [hand("s-in", "Midwall split", 1, "p-in"), hand("s-cu", "Copper", 12, "p-cu")],
});

const invoices = [
  { id: "i1", company_id: CO, status: "draft", grand_total: 10580, invoice_number: "DEMO-INV-1001", customer_name: "Pieter van Tonder (FAKE)" },
  { id: "i2", company_id: CO, status: "sent", sent_at: "2026-11-06", grand_total: 18745, notes: "DEPOSIT", invoice_number: "DEMO-INV-1002", customer_name: "Naledi Khumalo (FAKE)", expected_deposit_date: "2026-11-13" },
  { id: "i3", company_id: CO, status: "sent", sent_at: "2026-10-20", grand_total: 25990, notes: "Final", invoice_number: "DEMO-INV-1003", customer_name: "Sipho Pretorius (FAKE)", expected_final_date: "2026-11-03" },
];
const payments = [{ id: "p1", invoice_id: "i2", company_id: CO, amount: 8000, status: "paid", payment_date: "2026-11-10" }];
const job = (over: Partial<YardJob> & { id: string }): YardJob => ({
  company_id: CO, status: "scheduled", title: "Install", job_type: "installation", customer_name: "Amahle Dlamini (FAKE)", ...over,
});
const yard = buildYardHome({
  companyId: CO,
  now: NOW,
  invoices,
  payments,
  jobs: [
    job({ id: "j1", customer_name: "Amahle Dlamini (FAKE)", scheduled_for: "2026-11-20T09:00:00+02:00", assignee_name: "Tech Example", address: "14 Example Street, Stellenbosch (FAKE)" }),
    job({ id: "j2", customer_name: "Naledi Khumalo (FAKE)", status: "in_progress", job_type: "service", title: "Service", scheduled_for: "2026-11-19T08:30:00+02:00", started_at: "2026-11-19T08:40:00+02:00", assignee_name: "Tech Example", address: "3 Practice Lane, Somerset West (FAKE)" }),
  ],
  leads: [
    { id: "l1", company_id: CO, status: "pending", customer_name: "Amahle Dlamini (FAKE)", primary_intent: "sales", service_type: "installation", created_at: "2026-11-18T09:00:00+02:00" },
  ],
  quotes: [
    { id: "q1", company_id: CO, status: "draft", total: 21160, created_at: "2026-11-12T10:30:00+02:00", updated_at: "2026-11-12T10:30:00+02:00", customer_name: "Pieter van Tonder (FAKE)", quote_number: "DEMO-Q-1001" },
    { id: "q2", company_id: CO, status: "sent", total: 37490, created_at: "2026-11-04T12:00:00+02:00", sent_at: "2026-11-05T09:00:00+02:00", updated_at: "2026-11-05T09:00:00+02:00", customer_name: "Naledi Khumalo (FAKE)", quote_number: "DEMO-Q-1002" },
    { id: "q4", company_id: CO, status: "draft", total: 14720, created_at: "2026-10-01T09:00:00+02:00", updated_at: "2026-10-01T09:00:00+02:00", customer_name: "Lerato Molefe (FAKE)", quote_number: "DEMO-Q-1004" },
  ],
  bankState: "ready",
  bank: {
    accounts: [{ id: "a", label: "Demo current (FAKE)", account_ref: null, include: true, sort: 1 }],
    balances: [{ id: "b", account_id: "a", balance: 18400, as_of: "2026-11-18", created_at: "2026-11-18T08:00:00Z" }],
  },
  booksState: "ready",
  books: { receipts: [], commitments: [], allocations: [] },
});
const counts = countAdminHome({ companyId: CO, now: NOW, invoices, payments });

function Banner() {
  return (
    <div data-testid="demo-readonly-banner" style={{ margin: 0, padding: "8px 12px", background: "#fff7ed", color: "#7c2d12", fontSize: 13, fontWeight: 600 }}>
      View only. {DEMO_UX_COMPANY_NAME} uses fake clients. This login cannot change or send anything.
    </div>
  );
}

export default function DemoViewerHarness() {
  const [sp] = useSearchParams();
  const dark = sp.get("theme") === "dark";
  const screen = sp.get("screen") || "home";
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);

  let body = null;
  if (screen === "leads") {
    body = (
      <div style={{ padding: 16 }}>
        <OpenLeadsCard rows={yard.openLeadRows} warnDays={30} actions={{ canArchive: () => false, readOnly: true }} />
      </div>
    );
  } else if (screen === "quote") {
    body = (
      <div style={{ padding: 16 }} data-testid="demo-quote">
        <div className="rh-card" style={{ background: "rgba(255,255,255,.9)", padding: 16, borderRadius: 19 }}>
          <div className="rh-head"><h2>DEMO-Q-1002</h2><span className="rh-count">Sent</span></div>
          <p><b>Naledi Khumalo (FAKE)</b></p>
          <p className="rh-muted">3 Practice Lane, Somerset West (FAKE) · 080 000 1003</p>
          <div className="rh-row"><span>Midwall split 12000 BTU (FAKE)</span><b>R18 600</b></div>
          <div className="rh-row"><span>Install labour (FAKE)</span><b>R4 500</b></div>
          <div className="rh-row"><span>Copper and trunking (FAKE)</span><b>R9 500</b></div>
          <div className="rh-row"><span>Total incl. VAT</span><b>R37 490</b></div>
          <p className="rh-muted">Waiting on the client. Send is off for this login.</p>
        </div>
      </div>
    );
  } else if (screen === "job") {
    body = (
      <TechJobScreen
        readOnly
        type="Installation"
        client="Amahle Dlamini (FAKE)"
        area="Stellenbosch"
        when="09:00"
        duration="About 3 hours"
        phone="080 000 1001 · fake number"
        address="14 Example Street, Stellenbosch (FAKE)"
        check={install}
        description="FAKE install. Indoor and outdoor unit, 6 m of copper. Nothing here can be logged or completed."
        onLogParts={() => undefined}
        onComplete={() => undefined}
      />
    );
  } else if (screen === "invoice") {
    body = (
      <div className="p-4" data-testid="demo-invoice">
        <h1 className="mb-1 text-lg font-extrabold text-[#0F1B2A] dark:text-[#EAF2FA]">DEMO-INV-1003 · Sipho Pretorius (FAKE)</h1>
        <p className="mb-3 text-sm text-muted-foreground">21 Tutorial Close, Strand (FAKE) · Final · R25 990 · overdue · not emailed</p>
        <ExpectedFinalPaymentField preview invoice={{ id: "i3", status: "sent", issue_date: "2026-10-20", expected_final_payment_date: "2026-11-03" }} />
        <button type="button" disabled className="mt-3 rounded-md bg-[#C2410C]/40 px-3 py-2 text-sm font-semibold text-white">Send invoice</button>
      </div>
    );
  } else {
    body = (
      <AdminHomeScreen
        eyebrow="THURSDAY, 19 NOV"
        title="Good morning"
        companyName={DEMO_UX_COMPANY_NAME}
        invoice={yard.invoice.count > 0 ? yard.invoice : null}
        model={yard}
        crew={[
          { id: "1", href: "/dev/demo-viewer?screen=job", who: "Tech Example", type: "Installation", where: "Stellenbosch", client: "Amahle Dlamini (FAKE)" },
          { id: "2", href: "/dev/demo-viewer?screen=job", who: "Tech Example", type: "Service", where: "Somerset West", client: "Naledi Khumalo (FAKE)" },
        ]}
        levels={[{ key: "in", name: "Midwall splits (FAKE)", detail: "1 in stock · 1 needed this week", short: null, href: ADMIN_HOME_ROUTES.stock }]}
        orders={[]}
        slices={cashProjectionSlices(counts)}
        poolOnHand="R18 400"
        onSlice={() => undefined}
        onReview={() => undefined}
        onInvoice={() => undefined}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: dark ? "#0b1a2e" : "#e9e7e4" }} data-testid={`demo-viewer-${screen}`}>
      <Banner />
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <RoleMapFrame map={false}>{body}</RoleMapFrame>
      </div>
    </div>
  );
}
