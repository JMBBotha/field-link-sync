import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ListCard from "@/components/cards/ListCard";
describe("R2 ListCard", () => {
  it("shows title, subject line and opens on click", () => {
    const open = vi.fn();
    render(<ListCard title="Mrs Smith" amount="R 100" date="18/10" onOpen={open} />);
    expect(screen.getByText("Mrs Smith")).toBeTruthy();
    fireEvent.click(screen.getByRole("link"));
    expect(open).toHaveBeenCalled();
  });
  it("hides amount when caller passes none (role money-hiding)", () => {
    const { container } = render(<ListCard title="X" amount={null} onOpen={() => {}} />);
    expect(container.querySelector("[data-list-card-amount]")).toBeNull();
  });
});
