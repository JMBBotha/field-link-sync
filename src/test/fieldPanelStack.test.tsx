import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { PeekCard, usePeekStack } from "@/components/shared/CardStack";
import { LeadListSegmented } from "@/components/LeadListFilterPills";
const src = (p: string) => readFileSync(p, "utf8");

function Demo() {
  const p = usePeekStack<"x">();
  return <PeekCard id="x" open={p.isOpen("x")} onToggle={() => p.toggle("x")} onPointerEnter={p.enter("x")} onPointerLeave={p.leave("x")} title="Completed" summary="3"><p>body</p></PeekCard>;
}

describe("/field right panel card stack (Johan 09:44)", () => {
  it("shared PeekCard: closed strip, tap pins open, tap again closes", () => {
    const { container } = render(<Demo />);
    const card = container.querySelector("[data-card-stack=back]")!;
    expect(card.getAttribute("data-peek-open")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
    expect(card.getAttribute("data-peek-open")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
    expect(card.getAttribute("data-peek-open")).toBe("false");
  });
  it("segmented control: one row, counts inline, compact (opts out of 44px)", () => {
    let picked = "";
    render(<LeadListSegmented activeFilter="all" onFilterChange={(v) => (picked = v)} counts={{ all: 3, pending: 0, accepted: 1, in_progress: 2, completed: 0 }} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["All3", "Claimed1", "In Progress2"]);
    radios.forEach((r) => expect(r.hasAttribute("data-no-min")).toBe(true));
    fireEvent.click(radios[2]); expect(picked).toBe("in_progress");
  });
  it("FieldAgent panel order: earnings strip → active (front) → completed peek; reuses shared stack code", () => {
    const fa = src("src/pages/FieldAgent.tsx");
    const panel = fa.slice(fa.indexOf("data-field-stack"), fa.indexOf("{/* Mobile toggle moved to footer */}"));
    const iE = panel.indexOf("<MyEarningsPeek"), iA = panel.indexOf('data-stack-id="active"'), iC = panel.indexOf('<PeekCard id="completed"');
    expect(iE).toBeGreaterThan(-1); expect(iA).toBeGreaterThan(iE); expect(iC).toBeGreaterThan(iA);
    expect(panel).toContain("<LeadListSegmented");
    expect(panel).not.toContain("<LeadListFilterPills");
    expect(panel).toMatch(/flex min-h-0 flex-1 flex-col/); // active scrolls inside; completed strip always visible
    const pb = src("src/components/jobs/PipelineBoard.tsx");
    expect(pb).toContain("usePeekStack<PipelineStage>()");
    expect(pb).toContain("<PeekBody");
    expect(src("src/components/field/MyEarnings.tsx")).toMatch(/usePeekStack<"earnings">\(\)/); // collapsed by default
  });
});
