import { describe, expect, it, vi } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OpenLeadsCard } from "@/components/v8/roleHome/OpenLeadsCard";
import type { OpenLeadRow } from "@/lib/yardView";

const row = (over: Partial<OpenLeadRow> & { id: string }): OpenLeadRow => ({
  kind: "quote",
  customer: "Old client",
  stage: "Quoting",
  typeLabel: null,
  quoteRef: "0000086",
  amountLabel: "R76 427",
  href: "/admin/estimates/old",
  quoteId: "old",
  leadId: null,
  customerId: null,
  docStatus: "draft",
  ownerId: null,
  lastActivityAt: "2026-08-01T00:00:00Z",
  stale: true,
  ...over,
});

function renderCard(actions?: Parameters<typeof OpenLeadsCard>[0]["actions"], rows = [row({ id: "quote:old" })]) {
  return render(
    <MemoryRouter>
      <OpenLeadsCard rows={rows} actions={actions} />
    </MemoryRouter>,
  );
}

describe("Open leads card", () => {
  it("shows the old hint, the menu, and asks before archiving old leads", () => {
    const onSend = vi.fn();
    const onArchiveStale = vi.fn();
    renderCard({ forceMenuId: "quote:old", onSend, onArchiveStale, canArchive: () => true });
    expect(screen.getByTestId("open-lead-row")).toHaveAttribute("href", "/admin/estimates/old");
    expect(screen.getByTestId("open-lead-old")).toHaveTextContent("Old — archive?");
    expect(screen.getByTestId("open-lead-menu-send")).toBeInTheDocument();
    expect(screen.getByTestId("open-lead-menu-mark-sent")).toBeInTheDocument();
    expect(screen.getByTestId("open-lead-menu-archive")).toBeInTheDocument();
    expect(screen.getByTestId("open-lead-menu-open")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-lead-menu-send"));
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("archive-old-leads"));
    expect(screen.getByTestId("archive-old-confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("archive-old-confirm-yes"));
    expect(onArchiveStale).toHaveBeenCalledWith([expect.objectContaining({ id: "quote:old" })]);
  });

  it("hides archive when this person cannot archive the row", () => {
    renderCard({ forceMenuId: "quote:old", canArchive: () => false });
    expect(screen.queryByTestId("open-lead-menu-archive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("archive-old-leads")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-lead-menu-send")).toBeInTheDocument();
  });
});
