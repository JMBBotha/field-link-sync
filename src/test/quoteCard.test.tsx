import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuoteCard from "@/components/cards/QuoteCard";
import { buildDeals } from "@/lib/quotePipeline";

const deal = (status = "accepted") => buildDeals([
  { id: "q1", status, total: 2000, created_at: "2026-10-01T08:00:00Z", customer_name: "Client", quote_number: "Q-001" },
])[0];

describe("QuoteCard", () => {
  it("forwards drag props to the root without enabling drag by itself", () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const { container, rerender } = render(<QuoteCard deal={deal()} onOpen={vi.fn()} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} />);
    const root = container.querySelector("[data-deal-card]");
    expect(root?.getAttribute("draggable")).toBe("true");
    if (!root) throw new Error("Missing quote card");
    fireEvent.dragStart(root);
    fireEvent.dragEnd(root);
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragEnd).toHaveBeenCalledOnce();
    rerender(<QuoteCard deal={deal()} onOpen={vi.fn()} />);
    expect(root.hasAttribute("draggable")).toBe(false);
  });

  it("shows Book job only for accepted quotes and stops the open action", () => {
    const onBook = vi.fn();
    const onOpen = vi.fn();
    const { rerender } = render(<QuoteCard deal={deal()} onOpen={onOpen} onBook={onBook} />);
    fireEvent.click(screen.getByRole("button", { name: "Book job" }));
    expect(onBook).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    for (const status of ["draft", "sent", "viewed", "declined"]) {
      rerender(<QuoteCard deal={deal(status)} onOpen={onOpen} onBook={onBook} />);
      expect(screen.queryByRole("button", { name: "Book job" })).toBeNull();
    }
  });

  it("hides rep initials with showRep=false", () => {
    const { container, rerender } = render(<QuoteCard deal={deal()} repName="Johan Botha" onOpen={vi.fn()} />);
    expect(screen.getByTitle("Johan Botha").textContent).toBe("JB");
    rerender(<QuoteCard deal={deal()} repName="Johan Botha" showRep={false} onOpen={vi.fn()} />);
    expect(container.querySelector("[data-rep-initials]")).toBeNull();
  });
});