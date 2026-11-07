import { describe, expect, it, vi } from "vitest";

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
import { ADMIN_HOME_ROUTES } from "@/lib/roleHome";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";
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

function job(over: Partial<YardJob> & { id: string }): YardJob {
  return { company_id: MASSAIR_CT_ID, status: "scheduled", title: "Install", job_type: "installation", customer_name: "Fixture client", ...over };
}

function model(opts: { jobs?: boolean; invoices?: boolean } = {}) {
  const withJobs = opts.jobs !== false;
  const withInvoices = opts.invoices !== false;
  return buildYardHome({
    companyId: MASSAIR_CT_ID,
    now: NOW,
    invoices: withInvoices ? [
      { id: "draft-1", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 76426.79, invoice_number: "0010016", customer_name: "Sample client" },
      { id: "sent-1", company_id: MASSAIR_CT_ID, status: "sent", sent_at: "2026-11-01", grand_total: 800, notes: "DEPOSIT", invoice_number: "D", customer_name: "Sample client", expected_deposit_date: "2026-11-12" },
    ] : [],
    jobs: withJobs ? [
      job({ id: "job-1", scheduled_for: "2026-11-07T06:30:00+02:00", assignee_name: "Tech A" }),
      job({ id: "done-1", status: "completed", completed_at: "2026-11-07T14:00:00+02:00", customer_name: "Finished today" }),
    ] : [],
    bankState: "ready",
    bank: { accounts: [], balances: [] },
    booksState: "ready",
    books: { receipts: [], commitments: [], allocations: [] },
  });
}

function Home({ jobs = true, invoices = true, onInvoice = () => {} }: { jobs?: boolean; invoices?: boolean; onInvoice?: () => void }) {
  const navigate = useNavigate();
  const yard = model({ jobs, invoices });
  return (
    <AdminHomeScreen
      eyebrow="SATURDAY, 07 NOV"
      title="Good afternoon, Johan"
      companyName="Massair CT (Pty) Ltd"
      invoice={yard.invoice.count > 0 ? yard.invoice : null}
      model={yard}
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
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByTestId("jobs-ready-to-invoice")).toHaveLength(1);
    expect(screen.queryByTestId("admin-invoices-waiting")).toBeNull();
    expect(screen.queryByTestId("v8-role-greeting")).toBeNull();
    expect(screen.getByTestId("yard-bay-on_site")).toHaveAttribute("data-count", "0");
    expect(screen.getByTestId("yard-bay-on_site").querySelector("img")).toBeNull();
    expect(screen.getByTestId("yard-van-done")).toBeInTheDocument();
  });

  it("shows no invoice banner and no vans when nothing is booked or ready", () => {
    render(<MemoryRouter><Home jobs={false} invoices={false} /></MemoryRouter>);
    expect(screen.queryByTestId("jobs-ready-to-invoice")).toBeNull();
    expect(screen.queryByTestId("yard-van-waiting")).toBeNull();
    expect(screen.queryByTestId("yard-van-on_site")).toBeNull();
    expect(screen.getByTestId("yard-bay-waiting")).toHaveAttribute("data-count", "0");
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
    fireEvent.click(counted);
    expect(onInvoice).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("opens the yard jobs, book-a-job, and the deposit invoices from the home", () => {
    render(
      <MemoryRouter>
        <Home />
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("book-today-job")).toHaveAttribute("href", "/admin/jobs?new=1");
    fireEvent.click(screen.getByTestId("yard-bay-waiting"));
    expect(screen.getByTestId("yard-job-job-1")).toHaveAttribute("href", "/admin/jobs/job-1");
    expect(screen.getByTestId("yard-job-job-1")).toHaveTextContent("Fixture client");
    fireEvent.click(screen.getByTestId("money-deposits"));
    expect(screen.getByTestId("yard-money-line-sent-1")).toHaveAttribute("href", "/admin/invoices/sent-1");
    expect(screen.getByTestId("money-date-deposits")).toHaveTextContent("Expected 12 Nov");
    expect(screen.getByTestId("yard-money-panel").querySelector("a[href='/admin/invoices?money=deposits_due']")).toBeTruthy();
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
