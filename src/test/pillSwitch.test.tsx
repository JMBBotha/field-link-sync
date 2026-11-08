import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { Switch } from "@/components/ui/switch";

describe("shared sliding-pill switch", () => {
  it("opts out of the 44px square and keeps a capsule track with a full-height knob", () => {
    const { rerender } = render(<Switch aria-label="Project or estate" checked={false} />);
    const off = screen.getByRole("switch", { name: "Project or estate" });
    expect(off).toHaveAttribute("data-no-min");
    expect(off.className).toContain("w-[52px]");
    expect(off.className).toContain("h-[28px]");
    expect(off.className).toContain("bg-[#D0D5DC]");
    const knob = off.querySelector("span");
    expect(knob?.className).toContain("h-[22px]");
    expect(knob?.className).toContain("w-[22px]");
    expect(knob?.className).toContain("translate-x-0");
    rerender(<Switch aria-label="Project or estate" checked />);
    const on = screen.getByRole("switch", { name: "Project or estate" });
    expect(on.className).toContain("bg-[#1F4E73]");
    expect(on.querySelector("span")?.className).toContain("translate-x-[24px]");
  });

  it("locks the pill size after the phone 44px button rule", () => {
    const css = readFileSync("src/index.css", "utf8");
    const touch = css.indexOf("min-height: 44px");
    const pill = css.indexOf('button[role="switch"]');
    expect(touch).toBeGreaterThan(-1);
    expect(pill).toBeGreaterThan(touch);
    expect(css.slice(pill, pill + 400)).toContain("width: 52px");
    expect(css.slice(pill, pill + 400)).toContain("height: 28px");
    expect(readFileSync("src/components/ui/switch.tsx", "utf8")).toContain('data-no-min=""');
  });
});
