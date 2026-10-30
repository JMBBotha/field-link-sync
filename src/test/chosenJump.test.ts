import { describe, it, expect, vi } from "vitest";
import { jumpToQuoteLine } from "@/lib/chosenItems";

describe("jumpToQuoteLine", () => {
  it("opens a collapsed room before scrolling", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<section data-area-collapsed="true"><button class="option1-collapse" aria-expanded="false"></button><table><tr data-line-id="L1"></tr></table></section>`;
    const btn = document.querySelector("button")!;
    const click = vi.fn();
    btn.addEventListener("click", click);
    const row = document.querySelector<HTMLElement>("[data-line-id]")!;
    row.scrollIntoView = vi.fn();
    jumpToQuoteLine("L1");
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(row.scrollIntoView).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
