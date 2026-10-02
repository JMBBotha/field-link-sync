import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
import { EditableField, EditableNotes, EditableDateTime } from "./EditableFields";

const open = (name: string) => fireEvent.click(screen.getByText(name));

describe("click-to-edit fields never drop an edit silently", () => {
  it("saves on click-away (blur)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField label="Phone" value="082" onSave={onSave} />);
    open("082");
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "083" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("083"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
  it("saves when the dialog closes mid-edit (unmount)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<EditableField label="Phone" value="082" onSave={onSave} />);
    open("082");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "084" } });
    unmount();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("084"));
  });
  it("Cancel discards and does not save", async () => {
    const onSave = vi.fn();
    const { unmount } = render(<EditableField label="Phone" value="082" onSave={onSave} />);
    open("082");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "085" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("notes typed then dialog closed with Esc (no blur) are saved", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<EditableNotes label="Notes" value="a" onSave={onSave} />);
    const ta = screen.getByRole("textbox");
    fireEvent.focus(ta);
    fireEvent.change(ta, { target: { value: "a b" } });
    unmount();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("a b"));
  });
  it("date/time saves once on leaving the field, not per keystroke", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<EditableDateTime label="Scheduled For" value={new Date(2026, 9, 5, 10, 0).toISOString()} onSave={onSave} />);
    const [date] = Array.from(container.querySelectorAll("input")) as HTMLInputElement[];
    expect(date.value).toBe("2026-10-05");
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: "0002-10-06" } });
    fireEvent.change(date, { target: { value: "2026-10-06" } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(date);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(new Date(onSave.mock.calls[0][0]).getDate()).toBe(6);
  });
});
