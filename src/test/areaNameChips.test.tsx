import { fireEvent, render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AreaCreateControl, AreaNameChips, CanonicalAreaCreateControl, nextAreaName } from "@/components/quote/AreaNameChips";
import AreaDefinitionStep from "@/components/catalog/quote-builder/wizard/AreaDefinitionStep";
import { createEmptyArea } from "@/components/catalog/quote-builder/quoteWizardTypes";

afterEach(cleanup);
const names = ["Main bedroom", "Bedroom", "Guest bedroom", "Bedroom 1", "Lounge", "Kitchen", "Office", "Dining room", "Study", "Other (type own)"];

describe("shared area name chips", () => {
  it("renders every requested chip once, in order, directly after the input", () => {
    render(<AreaCreateControl existingNames={[]} onCreate={vi.fn()} />);
    const chips = screen.getByTestId("area-name-chips");
    expect(within(chips).getAllByRole("button").map((button) => button.textContent)).toEqual(names);
    expect(screen.getByRole("textbox").compareDocumentPosition(chips)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(chips.className).not.toMatch(/sticky|fixed|absolute/);
  });
  it("fills a chip name, keeps the existing create callback, and focuses Other without creating", async () => {
    let finish: (() => void) | undefined;
    const onCreate = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<AreaCreateControl existingNames={["Bedroom", "Bedroom 2"]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Other (type own)" }));
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Bedroom$/ }));
    expect(screen.getByRole("textbox")).toHaveValue("Bedroom 3");
    expect(onCreate).toHaveBeenCalledWith("Bedroom 3");
    finish?.();
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  });
  it("numbers repeated names case-insensitively without colliding or counting unrelated names", () => {
    expect(nextAreaName("Bedroom", [])).toBe("Bedroom");
    expect(nextAreaName("Bedroom", [" bedroom ", "Guest bedroom"])).toBe("Bedroom 2");
    expect(nextAreaName("Bedroom", ["Bedroom", "Bedroom 2", "Bedroom 3"])).toBe("Bedroom 4");
    expect(nextAreaName("Bedroom 1", ["Bedroom 1", "Bedroom 2"])).toBe("Bedroom 3");
  });
  it("creates numbered wizard areas through the original callback", async () => {
    const onAreasChange = vi.fn();
    const areas = [createEmptyArea("Bedroom"), createEmptyArea("Bedroom 2")];
    render(<AreaDefinitionStep areas={areas} onAreasChange={onAreasChange} controlsOnly />);
    fireEvent.click(screen.getByRole("button", { name: /^Bedroom$/ }));
    await waitFor(() => expect(onAreasChange).toHaveBeenCalledWith([...areas, expect.objectContaining({ name: "Bedroom 3" })]));
  });
  it("also supports fill-only callers without automatic creation", () => {
    const onPick = vi.fn();
    render(<AreaNameChips existingNames={[]} onPick={onPick} onOther={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Main bedroom" }));
    expect(onPick).toHaveBeenCalledWith("Main bedroom");
  });
  it("uses four primary choices and collapses subsequent creation into Add area", () => {
    const create = vi.fn();
    const view = render(<CanonicalAreaCreateControl existingNames={[]} onCreate={create} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent?.trim())).toEqual(["Main bedroom", "Guest bedroom", "Lounge", "Office", "Other…"]);
    fireEvent.click(screen.getByRole("button", { name: "Main bedroom" }));
    expect(create).toHaveBeenCalledWith("Main bedroom");
    view.rerender(<CanonicalAreaCreateControl existingNames={["Main bedroom"]} onCreate={create} />);
    expect(screen.getByRole("button", { name: "Add Area" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guest bedroom" })).not.toBeInTheDocument();
  });
});