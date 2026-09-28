import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { render, fireEvent, screen } from "@testing-library/react";
import { resolveMoneyFilter, parseLaneParam, parseInvoiceParams } from "@/lib/drilldown";
import RowMenu from "@/components/shared/RowMenu";

const p = (q: string) => new URLSearchParams(q);

describe("invoice spec aliases", () => {
  it("kind=deposit&state=due → deposits_due; partial → partially_paid", () => {
    expect(resolveMoneyFilter(p("kind=deposit&state=due"))).toBe("deposits_due");
    expect(resolveMoneyFilter(p("kind=deposit&state=partial"))).toBe("partially_paid");
    expect(parseInvoiceParams(p("kind=deposit&state=due")).state).toBeNull(); // not a status filter
  });
  it("money= still wins and unknowns are ignored", () => {
    expect(resolveMoneyFilter(p("money=outstanding&kind=deposit&state=due"))).toBe("outstanding");
    expect(resolveMoneyFilter(p("state=due"))).toBeNull();
    expect(resolveMoneyFilter(p("kind=deposit&state=paid"))).toBeNull();
  });
});

describe("inbox lane param", () => {
  it("parses sales|service only", () => {
    expect(parseLaneParam(p("inbox=1&lane=sales"))).toBe("sales");
    expect(parseLaneParam(p("lane=service"))).toBe("service");
    expect(parseLaneParam(p("lane=x"))).toBeNull();
  });
});

describe("row menu", () => {
  it("opening the menu does not trigger the row click", () => {
    const row = vi.fn();
    render(<div role="link" onClick={row} onKeyDown={row} onPointerDown={row}><RowMenu items={[{ label: "Open", onSelect: vi.fn() }]} /></div>);
    const btn = screen.getByLabelText("Actions");
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(row).not.toHaveBeenCalled();
  });
  it("hides hidden items and renders nothing when empty", () => {
    const { container } = render(<RowMenu items={[{ label: "x", onSelect: vi.fn(), hidden: true }]} />);
    expect(container.innerHTML).toBe("");
  });
});
