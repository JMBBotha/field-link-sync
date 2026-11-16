/** Demo of automatic expected dates. Numbers are harness rows, not live Massair. */
import { useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import "@/components/v8/roleHome/roleHome.css";
import { ExpectedMoneyBand } from "@/components/v8/roleHome/ExpectedMoneyBand";
import { InvoiceExpectForm, PayExpectSettingsForm, ProjectExpectForm } from "@/components/expected/PayExpectForms";
import { projectExpected } from "@/lib/expectedMoney";
import {
  STELLENBOSCH_PROJECT_ID,
  computeExpectedLines,
  payExpectSettings,
  toAutoExpected,
  type ExpectHouse,
  type ExpectInvoice,
  type ExpectJob,
  type PayExpectSettings,
  type ProjectExpectOverride,
} from "@/lib/expectedPayDates";

const company = "00000000-0000-4000-8000-0000000000aa";
const avec = "proj-avec";
const village = "proj-stellenbosch";
const many = "proj-many";
const cottage = "proj-cottage";
const today = "2026-11-16";
const houses: ExpectHouse[] = [
  { id: "s1", projectId: village, houseNo: "4" },
  { id: "s2", projectId: village, houseNo: "5" },
  { id: "a1", projectId: avec, houseNo: "12" },
  { id: "a2", projectId: avec, houseNo: "13" },
  { id: "m1", projectId: many, houseNo: "1" },
  { id: "m2", projectId: many, houseNo: "2" },
  { id: "c1", projectId: cottage, houseNo: "1" },
];
const projects = [
  { id: village, customerId: "cust-v" },
  { id: avec, customerId: "cust-a" },
  { id: many, customerId: "cust-m" },
  { id: cottage, customerId: "cust-c" },
];

function inv(over: Partial<ExpectInvoice> & { id: string; part: "deposit" | "final" }): ExpectInvoice {
  return { companyId: company, status: "sent", issueDate: "2026-11-16", sentAt: "2026-11-16", balance: 1000, customerName: "Client", invoiceNumber: over.id, notes: over.part === "deposit" ? "DEPOSIT" : "Final", ...over };
}

const blank = (projectId: string, over: Partial<ProjectExpectOverride> = {}): ProjectExpectOverride => ({
  projectId, timing: null, dateMode: "days_after", depositDays: null, finalDays: null, windowExtraDays: null, dayOfMonth: null, monthOffset: 0, ...over,
});

function picture(lines: ReturnType<typeof computeExpectedLines>, settings: PayExpectSettings) {
  return projectExpected({ today, cash: 48200, auto: toAutoExpected(lines), lateGraceDays: settings.lateGraceDays });
}

function Section({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId} style={{ margin: "18px 0", padding: 12, borderRadius: 16, background: "rgba(255,255,255,.72)" }}>
      <h2 style={{ margin: "0 0 8px", color: "#0F1B2A", fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

function Harness() {
  const [settings, setSettings] = useState<PayExpectSettings>(payExpectSettings(null));
  const [villageRule, setVillage] = useState<ProjectExpectOverride>(blank(village, { timing: "project", dateMode: "day_of_month", dayOfMonth: 15, monthOffset: 1 }));
  const [avecRule, setAvec] = useState<ProjectExpectOverride>(blank(avec, { timing: "project", dateMode: "month_end", monthOffset: 0 }));
  const [manyRule, setMany] = useState<ProjectExpectOverride>(blank(many));
  const [cottageRule, setCottage] = useState<ProjectExpectOverride>(blank(cottage));
  const [depositOn, setDepositOn] = useState("");
  const [finalOn, setFinalOn] = useState("");

  const overrides = [villageRule, avecRule, manyRule, cottageRule];
  const invoiceOverrides = [
    ...(depositOn ? [{ invoiceId: "nd", part: "deposit" as const, expectedOn: depositOn }] : []),
    ...(finalOn ? [{ invoiceId: "open", part: "final" as const, expectedOn: finalOn }] : []),
  ];
  const context = { settings, houses, projects, projectOverrides: overrides, invoiceOverrides, jobs: [] as ExpectJob[], quotes: [], defaultDepositPct: 50 };

  const projectLines = useMemo(() => computeExpectedLines({
    companyId: company,
    context: {
      ...context,
      jobs: [],
      quotes: [],
    },
    invoices: [
      inv({ id: "sv-d", part: "deposit", projectHouseId: "s1", customerName: "Stellenbosch Village", invoiceNumber: "SV-DEP", balance: 18500, issueDate: "2026-11-15" }),
      inv({ id: "sv-f", part: "final", projectHouseId: "s2", customerName: "Stellenbosch Village", invoiceNumber: "SV-FIN", balance: 18500, issueDate: "2026-11-15" }),
      inv({ id: "av-d", part: "deposit", projectHouseId: "a1", customerName: "AVEC", invoiceNumber: "AV-DEP", balance: 15000, issueDate: "2026-11-16" }),
      inv({ id: "av-f", part: "final", projectHouseId: "a2", customerName: "AVEC", invoiceNumber: "AV-FIN", balance: 6400, issueDate: "2026-11-16" }),
      inv({ id: "es-d", part: "deposit", projectHouseId: "m1", customerName: "Harbour Estate", invoiceNumber: "ES-DEP", balance: 9000, issueDate: "2026-11-16" }),
      inv({ id: "es-f", part: "final", projectHouseId: "m2", customerName: "Harbour Estate", invoiceNumber: "ES-FIN", balance: 4000, issueDate: "2026-11-20" }),
    ],
  }), [settings, villageRule, avecRule, manyRule, depositOn, finalOn]);

  const normalLines = useMemo(() => computeExpectedLines({
    companyId: company,
    invoicedQuoteIds: ["q-has"],
    context: {
      ...context,
      jobs: [
        { id: "j-done", quoteId: "q-done", completedAt: "2026-11-09T15:00:00+02:00" },
        { id: "j-open", quoteId: "q-open" },
      ],
      quotes: [
        { id: "q-new", companyId: company, status: "accepted", acceptedAt: "2026-11-13T10:00:00+02:00", total: 20000, customerName: "Harbour", quoteNumber: "Q-9", paymentPlan: { name: "50/50", stages: [{ pct: 50 }, { pct: 50 }] } },
      ],
    },
    invoices: [
      inv({ id: "nd", part: "deposit", customerName: "Harbour", invoiceNumber: "N-DEP", balance: 3000, quoteId: "q-has" }),
      inv({ id: "done", part: "final", customerName: "Harbour", invoiceNumber: "N-DONE", balance: 7000, quoteId: "q-done", issueDate: "2026-11-01" }),
      inv({ id: "open", part: "final", customerName: "Harbour", invoiceNumber: "N-OPEN", balance: 2000, quoteId: "q-open" }),
      inv({ id: "late", part: "deposit", customerName: "Harbour", invoiceNumber: "N-LATE", balance: 1800, issueDate: "2026-11-01" }),
      inv({ id: "cot", part: "deposit", projectHouseId: "c1", customerName: "Cottage", invoiceNumber: "C-DEP", balance: 2500 }),
      inv({ id: "paid", part: "deposit", status: "paid", balance: 900, customerName: "Paid client" }),
    ],
  }), [settings, cottageRule, depositOn, finalOn]);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <p style={{ margin: 0, padding: "4px 12px", background: "#0F1B2A", color: "#fff", fontSize: 12, fontWeight: 700 }}>
        Demo — harness, not live Massair. Stellenbosch Village live id {STELLENBOSCH_PROJECT_ID}. AVEC offset 0 is not confirmed.
      </p>
      <Section title="Project expected money" testId="shot-project">
        <ExpectedMoneyBand picture={picture(projectLines, settings)} startOpen />
      </Section>
      <Section title="Normal job" testId="shot-normal">
        <ExpectedMoneyBand picture={picture(normalLines, settings)} startOpen />
      </Section>
      <Section title="Settings and overrides" testId="shot-settings">
        <div style={{ display: "grid", gap: 16 }}>
          <PayExpectSettingsForm value={settings} onChange={setSettings} onSave={() => setSettings(payExpectSettings(settings))} />
          <h3 style={{ margin: 0 }}>Stellenbosch Village — 15th of the next month</h3>
          <ProjectExpectForm value={villageRule} houseCount={2} onChange={setVillage} onSave={() => undefined} onClear={() => setVillage(blank(village))} />
          <h3 style={{ margin: 0 }}>AVEC — last day of the invoice month</h3>
          <ProjectExpectForm value={avecRule} houseCount={2} hint="Offset 0 is a preview. Johan still has to confirm it." onChange={setAvec} onSave={() => undefined} onClear={() => setAvec(blank(avec))} />
          <h3 style={{ margin: 0 }}>Harbour Estate — days after the invoice</h3>
          <ProjectExpectForm value={manyRule} houseCount={2} onChange={setMany} onSave={() => undefined} onClear={() => setMany(blank(many))} />
          <h3 style={{ margin: 0 }}>Single house — normal unless forced</h3>
          <ProjectExpectForm value={cottageRule} houseCount={1} onChange={setCottage} onSave={() => undefined} onClear={() => setCottage(blank(cottage))} />
          <h3 style={{ margin: 0 }}>Invoice date override</h3>
          <InvoiceExpectForm deposit={depositOn} finalOn={finalOn} onDeposit={setDepositOn} onFinal={setFinalOn} onSave={() => undefined} />
        </div>
      </Section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Harness />
  </BrowserRouter>,
);
