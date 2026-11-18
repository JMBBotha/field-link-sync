import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("client pay screen", () => {
  it("pays the deposit in the Yoco sandbox and shows EFT as waiting", () => {
    open("/v8/client?role=admin");
    expect(screen.queryByTestId("v8-simple-tabs")).toBeNull();
    fireEvent.click(screen.getByTestId("v8-accept-pay"));
    fireEvent.click(screen.getByTestId("v8-yoco"));
    expect(screen.getByTestId("v8-deposit-paid").textContent).toMatch(/sandbox/i);
    expect(screen.queryByText(/PayFast/i)).toBeNull();
  });

  it("uses the quote number as the EFT reference, including a developer house", () => {
    open("/v8/client?role=admin&kind=developer");
    expect(screen.getByTestId("v8-client-page").textContent).toMatch(/House 12/);
    expect(screen.getByTestId("v8-payer").textContent).toMatch(/Demo Estate accounts/);
    expect(screen.getByTestId("v8-payer").textContent).not.toMatch(/resident/);
    fireEvent.click(screen.getByTestId("v8-accept-pay"));
    fireEvent.click(screen.getByTestId("v8-eft"));
    expect(screen.getByTestId("v8-eft-block").textContent).toMatch(/Q-H12/);
    expect(screen.getByTestId("v8-eft-block").textContent).toMatch(/Waiting for EFT/);
  });
});
