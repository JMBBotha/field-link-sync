import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AdminHomeScreen } from "@/components/v8/roleHome/screens";
import JobsCalmView from "@/components/jobs/calm/JobsCalmView";
import { ADMIN_HOME_ROUTES, cashProjectionSlices } from "@/lib/roleHome";
import { countAdminHome, MASSAIR_CT_ID, type HomeInvoice } from "@/lib/adminHomeCount";
import { buildYardHome, type YardJob } from "@/lib/yardView";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(() => { throw new Error("Review & send must not touch the database"); }) },
}));

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
}

const NOW = new Date("2026-11-07T15:33:00Z");

const draftAndDeposit: HomeInvoice[] = [
  { id: "draft-1", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 76426.79, invoice_number: "0010016", customer_name: "Sample client" },
  { id: "sent-1", company_id: MASSAIR_CT_ID, status: "sent", sent_at: "2026-11-01", grand_total: 800, notes: "DEPOSIT", invoice_number: "D", customer_name: "Sample client", expected_deposit_date: "2026-11-12" },
];

function moneyFor(invoices: HomeInvoice[], jobs: YardJob[] = []) {
  return buildYardHome({
    companyId: MASSAIR_CT_ID,
    now: NOW,
    invoices,
    jobs,
    bankState: "ready",
    bank: {
      accounts: [{ id: "a", label: "Current", account_ref: null, include: true, sort: 1 }],
      balances: [{ id: "b", account_id: "a", balance: 12500, as_of: "2026-11-03", created_at: "2026-11-03T08:00:00Z" }],
    },
    booksState: "ready",
    books: { receipts: [], commitments: [], allocations: [] },
  });
}

function Home({
  crew = [] as { id: string; href: string; who: string; type: string; where: string; client: string }[],
  invoices = draftAndDeposit,
  jobs = [] as YardJob[],
  onInvoice = () => {},
}: {
  crew?: { id: string; href: string; who: string; type: string; where: string; client: string }[];
  invoices?: HomeInvoice[];
  jobs?: YardJob[];
  onInvoice?: () => void;
}) {
  const navigate = useNavigate();
  const counts = countAdminHome({ companyId: MASSAIR_CT_ID, now: NOW, invoices });
  const yard = moneyFor(invoices, jobs);
  return (
    <AdminHomeScreen
      eyebrow="SATURDAY, 07 NOV"
      title="Good afternoon, Johan"
      companyName="Demo company (Pty) Ltd"
      invoice={counts.waiting.count > 0 ? { count: counts.waiting.count, total: "R76 426,79" } : null}
      crew={crew}
      levels={[{ key: "cu", name: "Copper pipe", detail: "12 in stock", short: null, href: ADMIN_HOME_ROUTES.stock }]}
      orders={[{ key: "cu", label: "6 m × Copper pipe", detail: "For booked installations", href: ADMIN_HOME_ROUTES.stock }]}
      slices={cashProjectionSlices(counts)}
      model={yard}
      onSlice={(s) => navigate(s.figure.actionHref)}
      onSliceInfo={() => {}}
      onReview={() => navigate(ADMIN_HOME_ROUTES.reviewSend)}
      onInvoice={onInvoice}
    />
  );
}

describe("admin home controls", () => {
  it("shows one greeting with the first name and one ready-to-invoice banner", () => {
    render(<MemoryRouter><Home /></MemoryRouter>);
    const greeting = screen.getByTestId("role-greeting");
    expect(greeting).toHaveTextContent("SATURDAY, 07 NOV");
    expect(greeting).toHaveTextContent("Good afternoon, Johan");
    expect(greeting).toHaveTextContent("Demo company (Pty) Ltd");
    expect(greeting).toHaveTextContent("Company overview");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByTestId("jobs-ready-to-invoice")).toHaveLength(1);
    expect(screen.queryByTestId("admin-invoices-waiting")).toBeNull();
    expect(screen.queryByTestId("v8-role-greeting")).toBeNull();
    expect(screen.getByText("Nothing booked today.")).toBeInTheDocument();
    expect(screen.getByTestId("today-jobs-heading")).toHaveTextContent("Jobs being done today");
    expect(screen.getByTestId("stock-levels-heading")).toHaveTextContent("Material & stock levels");
    expect(screen.getByTestId("cash-flow-heading")).toBeInTheDocument();
    expect(screen.queryByTestId("money-in-account")).toBeNull();
    expect(screen.getByTestId("money-cash")).toBeInTheDocument();
    expect(screen.getByTestId("money-open-leads")).toHaveTextContent("Not booked yet");
    expect(screen.getByTestId("money-jobs")).toBeInTheDocument();
    const pie = screen.getByTestId("cash-flow-projection");
    const work = screen.getByTestId("work-in-motion");
    expect(pie.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("yard-scene")).toBeInTheDocument();
    expect(screen.queryByTestId("yard-van-waiting")).toBeNull();
    expect(screen.getByTestId("yard-bay-on_site")).toHaveAttribute("data-count", "0");
    expect(screen.getByTestId("yard-bay-on_site").querySelector("img")).toBeNull();
    const homePage = readFileSync("src/pages/admin/AdminHomePage.tsx", "utf8");
    expect(homePage).not.toContain("dashboard-layout-switch");
    expect(homePage).not.toContain("Switch to classic view");
    expect(homePage).not.toContain("Switch to new view");
    expect(homePage).toContain("useLayoutVersion");
    expect(homePage).toContain("home-earlier-detail");
  });

  it("shows no invoice banner when nothing is ready to send", () => {
    render(<MemoryRouter><Home invoices={[]} /></MemoryRouter>);
    expect(screen.queryByTestId("jobs-ready-to-invoice")).toBeNull();
    expect(screen.queryByTestId("yard-van-waiting")).toBeNull();
    expect(screen.getByText("Nothing booked today.")).toBeInTheDocument();
  });

  it("sends Review & send to the draft list and does not send an invoice", () => {
    const onInvoice = vi.fn();
    render(
      <MemoryRouter>
        <Home onInvoice={onInvoice} />
        <Probe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("jobs-ready-review"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/invoices?state=draft");
    fireEvent.click(screen.getByTestId("jobs-ready-total"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/invoices?state=draft");
    const counted = screen.getByRole("button", { name: "How jobs ready to invoice was counted" });
    expect(counted).toHaveAttribute("data-no-min");
    expect(counted).toHaveStyle({ width: "18px", height: "18px", minHeight: "18px", maxHeight: "18px" });
    expect(counted.className).toContain("rounded-full");
    expect(counted.className).toContain("font-bold");
    expect(counted.className).toContain("not-italic");
    expect(counted.className.split(/\s+/)).not.toContain("italic");
    for (const name of ["How Deposits due was counted", "How Finals due was counted", "How Waiting to send was counted"]) {
      const mark = screen.getByRole("button", { name });
      expect(mark).toHaveAttribute("data-no-min");
      expect(mark).toHaveStyle({ width: "18px", height: "18px" });
      expect(mark.className.split(/\s+/)).not.toContain("italic");
    }
    fireEvent.click(counted);
    expect(onInvoice).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("opens jobs, the map, stock, a booked job, and the yard page from the cards", () => {
    render(
      <MemoryRouter>
        <Home crew={[{ id: "job-1", href: "/admin/jobs/job-1", who: "Tech A", type: "Installation", where: "Claremont", client: "Fixture client" }]} />
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("today-jobs-heading")).toHaveAttribute("href", "/admin/jobs");
    expect(screen.getByTestId("who-is-where")).toHaveAttribute("href", "/admin/map");
    expect(screen.getByTestId("admin-today-job")).toHaveAttribute("href", "/admin/jobs/job-1");
    expect(screen.getByTestId("stock-levels-heading")).toHaveAttribute("href", "/admin/cash-health?tab=stock");
    expect(screen.getByTestId("stock-orders-heading")).toHaveAttribute("href", "/admin/cash-health?tab=stock");
    expect(screen.getByTestId("stock-level")).toHaveAttribute("href", "/admin/cash-health?tab=stock");
    expect(screen.getByTestId("stock-order")).toHaveAttribute("href", "/admin/cash-health?tab=stock");
    expect(screen.getByTestId("cash-flow-heading")).toHaveAttribute("href", "/admin/cash-health");
    for (const book of screen.getAllByTestId("book-today-job")) {
      expect(book).toHaveAttribute("href", "/admin/jobs?new=1");
    }
    expect(screen.getByTestId("open-yard-view")).toHaveAttribute("href", "#work-in-motion");
    expect(screen.getByTestId("open-yard-view")).toHaveTextContent("Yard view");
    fireEvent.click(screen.getByTestId("open-yard-view"));
    expect(screen.getByTestId("loc")).not.toHaveTextContent("/admin/yard");
    expect(screen.getByTestId("yard-page-link")).toHaveAttribute("href", "/admin/yard");
    fireEvent.click(screen.getByTestId("cash-slice-deposit"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/invoices?money=deposits_due");
    const app = readFileSync("src/App.tsx", "utf8");
    const page = readFileSync("src/pages/admin/AdminYardPage.tsx", "utf8");
    expect(app).toContain('path="yard"');
    expect(page).toContain("YardLiveHome");
    expect(page).not.toContain("AdminHomeScreen");
  });

  it("shows the money block with the stored-date fallback and a direct link on each figure", () => {
    const invoices: HomeInvoice[] = [
      { id: "dep-expected", company_id: MASSAIR_CT_ID, status: "sent", sent_at: "2026-11-01", grand_total: 8000, notes: "DEPOSIT", invoice_number: "DEP-1", customer_name: "A", expected_deposit_date: "2026-11-12" },
      { id: "dep-manual", company_id: MASSAIR_CT_ID, status: "sent", sent_at: "2026-11-01", grand_total: 4000, notes: "DEPOSIT", invoice_number: "DEP-2", customer_name: "B", due_date: "2026-11-15", due_date_source: "manual", due_date_manual: true },
      { id: "fin-terms", company_id: MASSAIR_CT_ID, status: "sent", sent_at: "2026-11-01", grand_total: 9000, notes: "Final", invoice_number: "FIN-1", customer_name: "C", due_date: "2026-11-18", due_date_source: "terms" },
      { id: "fin-open", company_id: MASSAIR_CT_ID, status: "sent", sent_at: "2026-11-01", grand_total: 3000, notes: "Final", invoice_number: "FIN-2", customer_name: "D", final_unscheduled: true, due_date: "2026-11-20", due_date_source: "terms" },
    ];
    const yard = moneyFor(invoices);
    expect(yard.deposits.lines.map((line) => line.dateLabel)).toEqual(["Expected 12 Nov", "Expected 15 Nov"]);
    expect(yard.finals.lines.map((line) => line.dateLabel)).toEqual(["Due 18 Nov", "Due on completion"]);
    expect(yard.finals.lines[1].dateLabel).not.toContain("Expected");
    expect(yard.cash.dateLine).toBe("As at 3 Nov");
    expect(yard.cash.amountLabel).toBe("R12 500");
    expect(yard.liabilities.amountLabel).toBe("R0");

    render(
      <MemoryRouter>
        <Home invoices={invoices} />
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("money-in-account")).toBeNull();
    expect(screen.getByTestId("money-date-deposits")).toHaveTextContent("Next 12 Nov – 15 Nov");
    expect(screen.getByTestId("money-date-finals")).toHaveTextContent("Due 18 Nov");
    expect(screen.getByTestId("money-date-finals")).toHaveTextContent("1 due on completion");
    expect(screen.getByTestId("money-date-cash")).toHaveTextContent("As at 3 Nov");
    expect(screen.getByTestId("money-cash")).toHaveTextContent("R12 500");
    expect(screen.getByTestId("money-cash")).not.toHaveTextContent("R0");
    expect(screen.getByTestId("money-date-liabilities")).toHaveTextContent("Nothing still to buy");
    expect(screen.getByTestId("money-liabilities")).toHaveTextContent("R0");
    expect(screen.getByTestId("money-open-leads")).toHaveAttribute("href", "/admin/jobs?tab=pipeline");

    for (const [id, href] of [
      ["money-deposits", "/admin/invoices?money=deposits_due"],
      ["money-finals", "/admin/invoices?state=unpaid"],
      ["money-cash", "/admin/cash-health"],
      ["money-liabilities", "/admin/cash-health"],
    ] as const) {
      fireEvent.click(screen.getByTestId(id));
      const panel = screen.getByTestId("yard-money-panel");
      expect(panel.querySelector(`a[href='${href}']`)).toBeTruthy();
      fireEvent.click(screen.getByTestId("yard-money-panel-close"));
    }
  });

  it("keeps the van picture below the cards, with no van in an empty bay", () => {
    render(
      <MemoryRouter>
        <Home jobs={[{
          id: "leave",
          company_id: MASSAIR_CT_ID,
          status: "scheduled",
          title: "Install",
          job_type: "installation",
          customer_name: "Harbour",
          scheduled_for: "2026-11-07T06:30:00+02:00",
          assignee_name: "Tech A",
        }]} />
      </MemoryRouter>,
    );
    const pie = screen.getByTestId("cash-flow-projection");
    const work = screen.getByTestId("work-in-motion");
    expect(pie.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const empty = screen.getByTestId("yard-bay-on_site");
    expect(empty).toHaveAttribute("data-count", "0");
    expect(empty.querySelector("img")).toBeNull();
    expect(empty.tagName).toBe("DIV");
    const van = screen.getByTestId("yard-van-waiting") as HTMLImageElement;
    expect(van.style.objectFit).toBe("contain");
    expect(van.style.height).toBe("58px");
    expect(van.style.width).toBe("118px");
    fireEvent.click(screen.getByTestId("yard-bay-waiting"));
    expect(screen.getByTestId("yard-job-leave")).toHaveAttribute("href", "/admin/jobs/leave");
  });
});

describe("jobs add and edit", () => {
  it("shows Add job and Edit, and Edit opens the job", () => {
    const onNew = vi.fn();
    const onOpenBlock = vi.fn();
    render(
      <JobsCalmView
        tab="today" onTab={() => {}} dateLabel="Sat 7 Nov" onNew={onNew}
        leads={[]} leadsTotal={0} showAllLeads={false} onShowAll={() => {}}
        people={[{ id: "tech", name: "Tech A", role: "Tech", dot: "blue" }]}
        blocks={[{ id: "job-1", kind: "job", personId: "tech", day: "2026-11-07", start: 9 * 60, dur: 120, title: "Installation · Fixture", place: "Claremont", block: "install" }]}
        unassigned={[{ id: "open-1", title: "Unassigned fixture", sub: "Cape Town", age: "1h", lane: "service" }]}
        weekDays={[]} everyone="all" everyoneOptions={[{ value: "all", label: "Everyone ▾" }]} onEveryone={() => {}}
        chip={null} onChip={() => {}} counts={{ leadsNotContacted: 0, late: 0, unassigned: 1 }}
        onCallLead={() => {}} onAssignLead={() => {}} onOpenLead={() => {}}
        onAssignJob={() => {}} onOpenJob={onOpenBlock} onOpenBlock={onOpenBlock}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add job" }));
    expect(onNew).toHaveBeenCalled();
    expect(screen.getAllByText("Edit").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTestId("jobs-edit")[0]);
    expect(onOpenBlock).toHaveBeenCalledWith("open-1");
  });
});
