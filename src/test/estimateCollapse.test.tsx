import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EstimateDocument, { type EstimateEditing } from "@/components/quoting/EstimateDocument";
import AreaLabourRow from "@/components/quoting/AreaLabourRow";

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
    expect(control.parentElement).toBe(screen.getByTestId("estimate-areas-card"));
    expect(control.compareDocumentPosition(screen.getByTestId("estimate-totals"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(control.className).not.toMatch(/sticky|fixed|absolute/);
  });

  it("places creation after whole-job and unassigned labour, including newly added areas", () => {
    renderDocument({
      ...baseEditing,
      areas: [area, { id: "area-2", name: "Office", lines: [{ id: "service", name: "Service", description: null, quantity: 1, unit_price: 50 }] }],
      jobLabour: { lines: [], defaultHours: 3.5, onAdd: vi.fn() },
      unassignedLabour: [{ id: "extra", name: "Extra labour", description: null, quantity: 1, unit_price: 680 }],
      onLabourChange: vi.fn(),
      areaCreationControl: <div>Create area</div>,
    });
    const control = screen.getByTestId("inline-estimate-area-create");
    for (const preceding of [document.querySelector('[data-line-id="service"]'), screen.getByTestId("job-labour"), screen.getByTestId("unassigned-labour")]) {
      expect(preceding?.compareDocumentPosition(control)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(screen.getAllByTestId("inline-estimate-area-create")).toHaveLength(1);
  });

  it("keeps creation inside the empty areas card", () => {
    renderDocument({ ...baseEditing, areas: [], areaCreationControl: <div>Create area</div> });
    expect(screen.getByTestId("inline-estimate-area-create").parentElement).toBe(screen.getByTestId("estimate-areas-card"));
  });

  it("shows zero-hour outlined labour and uses the existing add path on tap", () => {
    const onAdd = vi.fn();
    render(<AreaLabourRow areaId="a" areaName="Bedroom" lines={[]} defaultHours={3.5} onAdd={onAdd} onChange={vi.fn()} />);
    expect(screen.getByTestId("area-labour-hours-row")).toHaveClass("border-2", "border-orange-500");
    expect(screen.queryByText("Labour needed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit labour hours for Bedroom" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("renders no empty labour in unit-free areas", () => {
    render(<AreaLabourRow areaId="a" areaName="Bedroom" lines={[]} defaultHours={0} onAdd={vi.fn()} onChange={vi.fn()} />);
    expect(screen.queryByTestId("area-labour-a")).toBeNull();
  });

  it("pencil opens rename chips and a repeated choice renames with numbering", () => {
    const rename = vi.fn();
    renderDocument({ ...baseEditing, areas: [area, { id: "second", name: "Main bedroom", lines: [] }], onRenameArea: rename });
    fireEvent.click(screen.getByRole("button", { name: "Rename area Bedroom" }));
    fireEvent.click(screen.getByRole("button", { name: "Main bedroom", exact: true }));
    expect(rename).toHaveBeenCalledWith("area-1", "Main bedroom 2");
    expect(screen.queryByTestId("canonical-area-choices")).toBeNull();
  });

  it("edits existing labour only on tap via onChange", () => {
    const onChange = vi.fn();
    render(<AreaLabourRow areaId="a" areaName="Bedroom" lines={[{ id: "lab", name: "Labour", description: null, quantity: 3.5, unit_price: 680 }]} defaultHours={3.5} onAdd={vi.fn()} onChange={onChange} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit labour hours for Bedroom" }));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("lab", 4);
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