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
import { ADMIN_HOME_ROUTES, cashProjectionSlices } from "@/lib/roleHome";
import { countAdminHome, MASSAIR_CT_ID } from "@/lib/adminHomeCount";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(() => { throw new Error("Review & send must not touch the database"); }) },
}));

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
}

const counts = countAdminHome({
  companyId: MASSAIR_CT_ID,
  now: new Date("2026-11-07T15:33:00Z"),
  invoices: [
    { id: "draft-1", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 76426.79, invoice_number: "0010016", customer_name: "Sample client" },
    { id: "sent-1", company_id: MASSAIR_CT_ID, status: "sent", sent_at: "2026-11-01", grand_total: 800, notes: "DEPOSIT", invoice_number: "D", customer_name: "Sample client" },
  ],
});

function Home({ crew = [] as { id: string; href: string; who: string; type: string; where: string; client: string }[], onInvoice = () => {} }: { crew?: { id: string; href: string; who: string; type: string; where: string; client: string }[]; onInvoice?: () => void }) {
  const navigate = useNavigate();
  return (
    <AdminHomeScreen
      eyebrow="SATURDAY, 07 NOV"
      title="Good afternoon, Johan"
      invoice={{ count: counts.waiting.count, total: "R76 426,79" }}
      crew={crew}
      levels={[{ key: "cu", name: "Copper pipe", detail: "12 in stock", short: null, href: ADMIN_HOME_ROUTES.stock }]}
      orders={[{ key: "cu", label: "6 m × Copper pipe", detail: "For booked installations", href: ADMIN_HOME_ROUTES.stock }]}
      slices={cashProjectionSlices(counts)}
      onSlice={(s) => navigate(s.figure.actionHref)}
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
    fireEvent.click(screen.getByRole("button", { name: "How jobs ready to invoice was counted" }));
    expect(onInvoice).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("opens jobs, the map, stock, and a booked job from the cards", () => {
    render(
      <MemoryRouter>
        <Home crew={[{ id: "job-1", href: "/admin/jobs/job-1", who: "Tech A", type: "Installation", where: "Claremont", client: "Fixture client" }]} />
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("today-jobs-heading")).toHaveAttribute("href", "/admin/jobs");
    expect(screen.getByTestId("who-is-where")).toHaveAttribute("href", "/admin/map");
    expect(screen.getByTestId("book-today-job")).toHaveAttribute("href", "/admin/jobs?new=1");
    expect(screen.getByTestId("admin-today-job")).toHaveAttribute("href", "/admin/jobs/job-1");
    expect(screen.getByTestId("stock-levels-heading")).toHaveAttribute("href", "/admin/cash-health?tab=stock");
    expect(screen.getByTestId("stock-orders-heading")).toHaveAttribute("href", "/admin/cash-health?tab=stock");
    expect(screen.getByTestId("stock-level")).toHaveAttribute("href", "/admin/cash-health?tab=stock");
    expect(screen.getByTestId("stock-order")).toHaveAttribute("href", "/admin/cash-health?tab=stock");
    expect(screen.getByTestId("cash-flow-heading")).toHaveAttribute("href", "/admin/cash-health");
    expect(screen.getByTestId("cash-slice-waiting")).toBeInTheDocument();
    expect(screen.getByTestId("cash-slice-deposit")).toBeInTheDocument();
    expect(screen.getByTestId("cash-slice-final")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cash-slice-deposit"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/invoices?money=deposits_due");
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
