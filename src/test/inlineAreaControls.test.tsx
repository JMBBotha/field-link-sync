import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AreaDefinitionStep from "@/components/catalog/quote-builder/wizard/AreaDefinitionStep";
import { createEmptyArea } from "@/components/catalog/quote-builder/quoteWizardTypes";

afterEach(cleanup);

describe("inline wizard area creation", () => {
  it("follows the last area after adding another section", () => {
    const onAreasChange = vi.fn();
    const areas = [createEmptyArea("Bedroom")];
    const r = render(<AreaDefinitionStep areas={areas} onAreasChange={onAreasChange} />);
    const assertTail = (name: string) => {
      const input = screen.getByDisplayValue(name);
      const control = screen.getByTestId("inline-area-create");
      expect(input.compareDocumentPosition(control)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(screen.getAllByTestId("inline-area-create")).toHaveLength(1);
      expect(control.className).not.toMatch(/sticky|fixed|absolute/);
    };
    assertTail("Bedroom");
    r.rerender(<AreaDefinitionStep areas={[...areas, createEmptyArea("Office")]} onAreasChange={onAreasChange} />);
    assertTail("Office");
  });

  it("keeps the existing custom-name action available in controls-only and empty states", () => {
    const onAreasChange = vi.fn();
    render(<AreaDefinitionStep areas={[]} onAreasChange={onAreasChange} controlsOnly />);
    expect(screen.getAllByRole("button", { name: "Add Area" })).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("button", { name: "Add Area" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom..." }));
    fireEvent.change(screen.getByPlaceholderText("Enter custom area name..."), { target: { value: "Study" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAreasChange).toHaveBeenCalledWith([expect.objectContaining({ name: "Study" })]);
  });
});