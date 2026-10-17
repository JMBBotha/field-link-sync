import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import SendStateButton from "@/components/quoting/SendStateButton";

const labels = { idle: "Email", busy: "Email sending…", slow: "Still sending, please wait", done: "Email sent ✓", failed: "Not sent" };

describe("send window button states (17 Oct restyle)", () => {
  it.each([
    ["idle", "Email", false],
    ["busy", "Email sending…", true],
    ["slow", "Still sending, please wait", true],
  ] as const)("%s → %s, locked=%s", (state, label, locked) => {
    render(<SendStateButton state={state} labels={labels} testId="b" />);
    const b = screen.getByTestId("b");
    expect(b).toHaveTextContent(label);
    expect(b.className).toContain(`is-${state}`);
    expect((b as HTMLButtonElement).disabled).toBe(locked);
  });
  it("sent and failed are coloured states", () => {
    render(<SendStateButton state="done" labels={labels} testId="d" disabled />);
    render(<SendStateButton state="failed" labels={labels} testId="f" disabled />);
    expect(screen.getByTestId("d").className).toContain("is-done");
    expect(screen.getByTestId("f")).toHaveTextContent("Not sent");
  });
  it("no browser OK/Cancel left on quote send paths", () => {
    for (const f of ["src/components/admin/KpiHoverPreview.tsx", "src/components/quoting/AcceptedWorkSection.tsx", "src/components/quoting/SendQuoteDialog.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toContain("window.confirm");
    }
  });
});

describe("failed state keeps Retry reachable (17 Oct follow-up)", () => {
  const src = readFileSync("src/components/quoting/SendQuoteDialog.tsx", "utf8");
  it("Retry + reason live in the sticky footer", () => {
    const foot = src.slice(src.indexOf('className="fl-send-foot sticky bottom-0'));
    expect(foot.indexOf('data-testid="send-failed-bar"')).toBeGreaterThan(-1);
    expect(foot.indexOf('testId="send-retry"')).toBeGreaterThan(-1);
    expect(src.split('testId="send-retry"').length).toBe(2); // only one Retry
  });
  it("email card scrolls into view when the state becomes failed", () => {
    expect(src).toMatch(/emailState === "failed"\) \{\s*const t = window\.setTimeout\(\(\) => emailCardRef\.current\?\.scrollIntoView/);
  });
});
