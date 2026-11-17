import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import V8SimpleShell from "@/components/v8simple/V8SimpleShell";
import { v8SimpleChildRoutes } from "@/pages/V8SimpleRoutes";

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v8" element={<V8SimpleShell root="/v8" />}>
          {v8SimpleChildRoutes()}
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("jobs screen", () => {
  it("filters by the stage in the URL", () => {
    open("/v8/jobs?role=admin&stage=deposit_due");
    expect(screen.getByTestId("v8-count-deposit_due").textContent).toBe("1");
    expect(screen.getByTestId("v8-job-list").textContent).toContain("Demo client D");
    expect(screen.getByTestId("v8-job-list").textContent).not.toContain("Demo client A");
    expect(screen.getByTestId("v8-job-list").textContent).not.toMatch(/PayFast/i);
  });

  it("money view shows the admin home totals", () => {
    open("/v8/jobs?role=admin&view=money");
    const totals = screen.getByTestId("v8-money-totals").textContent || "";
    expect(totals).toContain("R8 000");
    expect(totals).toContain("R22 000");
    expect(totals).toContain("R4 500");
    expect(screen.queryByTestId("v8-money-view")).not.toBeNull();
  });

  it("hides the money view from sales and the list from techs", () => {
    open("/v8/jobs?role=sales");
    expect(screen.queryByTestId("v8-money-view")).toBeNull();
    open("/v8/jobs?role=tech");
    expect(screen.getByTestId("v8-jobs-tech").textContent).toMatch(/no money totals/i);
  });
});
