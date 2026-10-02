import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: any[]) => toastSpy(...a) }));
import { EditableField, EditableNotes } from "./EditableFields";

describe("EditableField save", () => {
  it("shows a labelled Save button that saves and toasts", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField label="Address" value="Address pending — WhatsApp confirmation sent" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2 Thompson Street, Strand" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("2 Thompson Street, Strand"));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: "Address saved" }));
  });
  it("Enter also saves", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField label="Address" value="" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "10 Main Rd" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("10 Main Rd"));
  });
});

describe("EditableNotes", () => {
  it("long notes get a Show all toggle that grows the box", () => {
    render(<EditableNotes label="Notes" value={"x".repeat(1000)} onSave={vi.fn()} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.rows).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(ta.rows).toBeGreaterThan(6);
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });
});
