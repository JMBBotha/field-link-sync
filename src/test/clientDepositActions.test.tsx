import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatRand } from "@/utils/formatRand";
import { buildDepositWhatsAppUrl } from "@/lib/depositShare";
import ClientDepositActions from "@/components/client/ClientDepositActions";

describe("formatRand (shared SA currency formatter)", () => {
  it("formats 9774.6 as R 9 774,60", () => {
    expect(formatRand(9774.6)).toBe("R 9 774,60");
  });
});

describe("buildDepositWhatsAppUrl", () => {
  it("prefills invoice number, formatted amount and pay link, with no phone number", () => {
    const url = buildDepositWhatsAppUrl("INV-017", 9774.6, "https://example.com/quote/abc");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("INV-017");
    expect(text).toContain("R 9 774,60");
    expect(text).toContain("https://example.com/quote/abc");
  });
});

describe("ClientDepositActions", () => {
  const invoice = {
    id: "72cd0626-6a1f-48e5-a9b6-eb37b0bb328f",
    invoice_number: "INV-017",
    status: "draft",
    grand_total: 9774.6,
    paid_date: null,
    notes: null,
  };

  it("shows the invoice number next to the deposit amount", () => {
    render(<ClientDepositActions invoice={invoice} payUrl="https://example.com/quote/abc" />);
    expect(screen.getByText(/Invoice INV-017/)).toBeInTheDocument();
    expect(screen.getByText(/R 9 774,60/)).toBeInTheDocument();
  });

  it("renders a Share on WhatsApp button whose link contains the invoice number", () => {
    render(<ClientDepositActions invoice={invoice} payUrl="https://example.com/quote/abc" />);
    const wa = screen.getByRole("link", { name: /Share on WhatsApp/i });
    expect(wa).toHaveAttribute("href", expect.stringContaining("https://wa.me/?text="));
    expect(decodeURIComponent(wa.getAttribute("href") || "")).toContain("INV-017");
  });
});
