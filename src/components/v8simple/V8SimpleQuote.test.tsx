import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

describe("quote screen", () => {
  it("sends with one discount and lists the pack", () => {
    open("/v8/quote?role=sales");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("v8-quote-totals").textContent).toMatch(/Deposit 70%/);
    expect(screen.getByTestId("v8-pack-list").textContent).toMatch(/9 000 BTU midwall/);
    expect(screen.getByTestId("v8-pack-list").textContent).toMatch(/Copper pipe/);
    expect(screen.getByTestId("v8-pack-list").textContent).not.toMatch(/labour/i);
    fireEvent.change(screen.getByLabelText("Discount percent"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("v8-discount-reason").textContent).toMatch(/one discount/i);
    expect(document.querySelectorAll("[data-orange='main']")).toHaveLength(1);
    expect(screen.queryByText(/PayFast/i)).toBeNull();
  });

  it("blocks a discount over 15%", () => {
    open("/v8/quote?role=admin");
    fireEvent.change(screen.getByLabelText("Discount percent"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("v8-discount-reason").textContent).toMatch(/15%/);
  });
});
