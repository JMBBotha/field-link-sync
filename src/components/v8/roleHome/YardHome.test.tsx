import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";
import { buildYardHome, type YardJob } from "@/lib/yardView";
import { YardHome } from "./YardHome";

const CT = MASSAIR_CT_ID;
const NOW = new Date("2026-11-07T08:00:00+02:00");

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function job(over: Partial<YardJob> & { id: string }): YardJob {
  return { company_id: CT, status: "scheduled", title: "Install", job_type: "installation", customer_name: "Client", ...over };
}

function model() {
  return buildYardHome({
    companyId: CT,
    now: NOW,
    invoices: [
      { id: "dep", company_id: CT, status: "sent", sent_at: "2026-11-01", grand_total: 8000, notes: "DEPOSIT", invoice_number: "DEP-9", customer_name: "Harbour", expected_deposit_date: "2026-11-12" },
    ],
    jobs: [
      job({ id: "leave", customer_name: "Harbour", scheduled_for: "2026-11-07T06:30:00+02:00", assignee_name: "Tech A", job_type: "installation" }),
      job({ id: "road", customer_name: "Sea Point", status: "dispatched", en_route_at: "2026-11-07T07:00:00+02:00", scheduled_for: "2026-11-07T07:00:00+02:00", assignee_name: "Tech B" }),
      job({ id: "done", customer_name: "Claremont", status: "completed", completed_at: "2026-11-07T09:00:00+02:00", assignee_name: "Tech A" }),
    ],
    bankState: "ready",
    bank: {
      accounts: [{ id: "a", label: "Current", account_ref: null, include: true, sort: 1 }],
      balances: [{ id: "b", account_id: "a", balance: 186400, as_of: "2026-11-03", created_at: "2026-11-03T08:00:00Z" }],
    },
    booksState: "ready",
    books: { receipts: [], commitments: [], allocations: [] },
  });
}

describe("yard view vans and dated money", () => {
  it("renders a van only when the stage count is above zero, and keeps the wheels inside the box", () => {
    const { container } = render(<MemoryRouter><YardHome model={model()} /></MemoryRouter>);
    const empty = screen.getByTestId("yard-bay-on_site");
    expect(empty).toHaveAttribute("data-count", "0");
    expect(empty.querySelector("img")).toBeNull();
    expect(empty.tagName).toBe("DIV");
    expect(screen.queryByTestId("yard-van-on_site")).toBeNull();

    const van = screen.getByTestId("yard-van-waiting") as HTMLImageElement;
    expect(van.style.objectFit).toBe("contain");
    expect(van.style.height).toBe("58px");
    expect(van.style.width).toBe("118px");
    expect(van.style.overflow).toBe("visible");
    expect(screen.getByTestId("yard-bay-waiting")).toHaveStyle({ overflow: "visible" });
    expect(container.querySelectorAll("img.yard-van, img[data-testid^='yard-van-']").length).toBe(3);
  });

  it("opens the jobs in a stage from the van, and the dated invoices from a money figure", () => {
    render(<MemoryRouter><YardHome model={model()} /></MemoryRouter>);
    expect(screen.getByTestId("money-date-deposits")).toHaveTextContent("Expected 12 Nov");
    expect(screen.getByTestId("money-date-cash")).toHaveTextContent("As at 3 Nov");
    expect(screen.getByTestId("money-cash")).toHaveTextContent("R186 400");

    fireEvent.click(screen.getByTestId("yard-bay-waiting"));
    const panel = screen.getByTestId("yard-stage-panel");
    expect(panel).toHaveTextContent("Harbour");
    expect(panel).toHaveTextContent("Installation");
    expect(panel).toHaveTextContent("Tech A");
    expect(panel).toHaveTextContent("Waiting to leave");
    expect(screen.getByTestId("yard-job-leave")).toHaveAttribute("href", "/admin/jobs/leave");

    fireEvent.click(screen.getByTestId("yard-bay-on_site"));
    expect(screen.getByTestId("yard-stage-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("money-deposits"));
    const money = screen.getByTestId("yard-money-panel");
    expect(money).toHaveTextContent("DEP-9 · Harbour");
    expect(money).toHaveTextContent("Expected 12 Nov");
    expect(screen.getByTestId("yard-money-line-dep")).toHaveAttribute("href", "/admin/invoices/dep");
  });
});
