import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EstimateDocument, { type EstimateEditing } from "@/components/quoting/EstimateDocument";

vi.mock("@/hooks/useCompanySettings", () => ({
  useCompanySettings: () => ({ settings: { company_name: "", physical_address: "", vat_number: "", banking_details: {} } }),
}));

const area = {
  id: "area-1",
  name: "Bedroom",
  lines: [
    { id: "line-1", name: "Unit", description: null, quantity: 1, unit_price: 100 },
    { id: "line-2", name: "Material", description: null, quantity: 1, unit_price: 50 },
  ],
};

const baseEditing: EstimateEditing = {
  areas: [area],
  selectedLineId: null,
  onSelectLine: vi.fn(),
  onLineChange: vi.fn(),
  onDeleteLine: vi.fn(),
  onRenameArea: vi.fn(),
  onAddArea: vi.fn(),
};

const renderDocument = (editing?: EstimateEditing) => render(
  <EstimateDocument
    estimateNumber="Q1"
    issueDate="2026-09-29"
    customerName="Customer"
    items={[]}
    subtotal={150}
    taxRate={0.15}
    taxAmount={22.5}
    grandTotal={172.5}
    editing={editing}
  />,
);

describe("estimate area collapse", () => {
  it("renders one custom creation control after the last section, without the generic duplicate", () => {
    const r = renderDocument({ ...baseEditing, areaCreationControl: <div>Create area · Bedroom · Lounge</div> });
    const control = screen.getByTestId("inline-estimate-area-create");
    const section = r.container.querySelector('[data-area-id="area-1"]');
    expect(section?.compareDocumentPosition(control)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole("button", { name: "Add area" })).toBeNull();
    expect(screen.getAllByText("Create area · Bedroom · Lounge")).toHaveLength(1);
    expect(control).toHaveAttribute("data-html2canvas-ignore");
  });

  it("keeps collapsed rows mounted and printable", () => {
    renderDocument({ ...baseEditing, collapsedAreaKeys: new Set(["area-1"]), onToggleArea: vi.fn() });
    expect(screen.getByRole("button", { name: "Show 2 items" })).toHaveAttribute("aria-expanded", "false");
    const table = document.querySelector('[data-area-id="area-1"] table');
    expect(table).toHaveClass("hidden", "print:table");
    expect(document.querySelectorAll('[data-area-id="area-1"] [data-line-id]')).toHaveLength(2);
  });

  it("toggles the area key and leaves an open table visible", () => {
    const onToggleArea = vi.fn();
    renderDocument({ ...baseEditing, collapsedAreaKeys: new Set(), onToggleArea });
    const toggle = screen.getByRole("button", { name: "Hide items" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(onToggleArea).toHaveBeenCalledWith("area-1");
    expect(document.querySelector('[data-area-id="area-1"] table')).not.toHaveClass("hidden");
  });

  it("does not collapse or show a toggle without collapse controls", () => {
    renderDocument(baseEditing);
    expect(screen.queryByRole("button", { name: /items/i })).toBeNull();
    expect(document.querySelector('[data-area-id="area-1"] table')).not.toHaveClass("hidden");
  });

  it("keeps the client render free of collapse controls and hidden tables", () => {
    renderDocument();
    expect(screen.queryByRole("button", { name: /items/i })).toBeNull();
    expect(document.querySelectorAll("table.hidden")).toHaveLength(0);
  });
});