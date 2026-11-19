import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExpectedFinalPaymentField } from "./ExpectedFinalPaymentField";

describe("expected final payment field", () => {
  it("shows the invoice date, accepts an override, and can return to the invoice date", () => {
    render(<ExpectedFinalPaymentField preview invoice={{ id: "inv-045", status: "sent", issue_date: "2026-11-16", expected_final_payment_date: null }} />);
    expect(screen.getByText("Expected final payment")).toBeInTheDocument();
    expect(screen.getByTestId("expected-final-payment-shown")).toHaveTextContent("16 Nov");
    expect(screen.getByTestId("expected-final-payment-shown")).toHaveTextContent("invoice date");
    fireEvent.change(screen.getByLabelText("Expected final payment"), { target: { value: "2026-12-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTestId("expected-final-payment-shown")).toHaveTextContent("20 Dec");
    expect(screen.getByTestId("expected-final-payment-shown")).not.toHaveTextContent("invoice date");
    fireEvent.click(screen.getByTestId("expected-final-payment-reset"));
    expect(screen.getByTestId("expected-final-payment-shown")).toHaveTextContent("invoice date");
  });
});
