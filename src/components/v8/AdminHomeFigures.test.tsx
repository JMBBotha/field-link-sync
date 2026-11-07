import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { MASSAIR_CT_ID, countAdminHome, type CountFigure, type HomeInvoice } from "@/lib/adminHomeCount";
import { AdminHomePies, HowCountedSheet, InvoicesWaitingCard } from "./AdminHomeFigures";

const NOW = new Date("2026-11-06T10:00:00+02:00");
const invoices: HomeInvoice[] = [
  { id: "a", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 18400, customer_name: "Client 5", invoice_number: "INV-D-021" },
  { id: "b", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 1000, customer_name: "Client 8", invoice_number: "INV-D-022" },
];

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
}

function Harness() {
  const counts = countAdminHome({ companyId: MASSAIR_CT_ID, now: NOW, invoices, jobs: [
    { id: "j1", company_id: MASSAIR_CT_ID, job_type: "service", title: "Service", status: "scheduled", scheduled_for: "2026-11-03T08:00:00+02:00", customer_name: "Client 5" },
  ] });
  const [figure, setFigure] = useState<CountFigure | null>(null);
  return (
    <>
      <InvoicesWaitingCard figure={counts.waiting} onOpen={() => setFigure(counts.waiting)} />
      <AdminHomePies counts={counts} onOpen={setFigure} />
      {figure && <HowCountedSheet figure={figure} onClose={() => setFigure(null)} />}
    </>
  );
}

describe("admin home pies and how-counted sheet", () => {
  it("opens the sheet from the invoices figure and links each row to the record", () => {
    render(<MemoryRouter><Harness /><Probe /></MemoryRouter>);
    expect(screen.getByTestId("admin-home-pies").className).toContain("grid-cols-1");
    expect(screen.getByTestId("admin-home-pies").className).toContain("md:grid-cols-2");
    fireEvent.click(screen.getByRole("button", { name: "How invoices waiting was counted" }));
    expect(screen.getByRole("dialog", { name: "How this was counted" })).toBeInTheDocument();
    expect(screen.getByText(/2 draft invoices that have not been emailed yet/)).toBeInTheDocument();
    expect(screen.getByText(/The call-out fee is never deducted/)).toBeInTheDocument();
    const line = screen.getByTestId("how-counted-line-a");
    expect(line).toHaveAttribute("href", "/admin/invoices/a");
    expect(line).toHaveTextContent("INV-D-021 · Client 5");
    fireEvent.click(screen.getByTestId("how-counted-action"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/invoices?state=draft");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the draft invoice list from a money slice, and the sheet from how-counted", () => {
    render(<MemoryRouter><Harness /><Probe /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Waiting to send/ }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/invoices?state=draft");
    fireEvent.click(screen.getByRole("button", { name: "How the money total was counted" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Where the money sits");
    fireEvent.click(screen.getByTestId("how-counted-close"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
