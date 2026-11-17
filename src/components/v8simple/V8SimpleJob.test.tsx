import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import V8SimpleShell from "@/components/v8simple/V8SimpleShell";
import { v8SimpleChildRoutes } from "@/pages/V8SimpleRoutes";
import { planPastSave } from "@/lib/bookJobPath";

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

describe("job page", () => {
  it("changes the orange button with the stage and does not send a past visit", () => {
    open("/v8/jobs/dep-1?role=admin");
    expect(screen.getByTestId("v8-next-step").textContent).toBe("Resend pay link");
    expect(screen.getAllByRole("button", { name: "Resend pay link" })).toHaveLength(1);
    expect(document.querySelectorAll("[data-orange='main']")).toHaveLength(1);
    expect(screen.getByTestId("v8-past-quiet").textContent).toMatch(/not messaged/i);
    const plan = planPastSave({
      doing: "past", visitKinds: ["ac_installation"], existingJobId: "dep-1",
      completed: true, date: "2026-11-16", today: "2026-11-17", role: { isAdmin: true },
    });
    expect(plan.messageClient).toBe(false);
    expect(plan.alertReps).toBe(false);
    expect(plan.rpc).toBe("admin_backfill_visit");
    fireEvent.click(screen.getByTestId("v8-next-step"));
    expect(screen.getByTestId("v8-next-note").textContent).toMatch(/Nothing was sent/i);
    expect(readFileSync("src/components/v8simple/V8SimpleJob.tsx", "utf8")).not.toMatch(/sendMessage|notifyRep|whatsapp/i);
  });

  it("hides money from a technician", () => {
    open("/v8/jobs/bal-1?role=tech");
    expect(screen.getByTestId("v8-job").textContent).toMatch(/No money totals/i);
    expect(screen.getByTestId("v8-job").textContent).not.toMatch(/R\d/);
    expect(screen.queryByTestId("v8-simple-book")).toBeNull();
  });
});
