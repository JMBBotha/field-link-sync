import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatCustomerAddress, resolveBillTo, siteLineFor } from "@/lib/billTo";
import BrandDocument from "@/components/documents/BrandDocument";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));

const client = {
  name: "Marina Botha", company_name: "Marina Holdings (Pty) Ltd",
  primary_address_line1: "12 Main Road", primary_address_line2: "Unit 4", city: "Fourways", postal_code: "2191",
  address: "old address", vat_number: "4123456789",
};

describe("bill-to rules", () => {
  it("formats the full company address", () => {
    expect(formatCustomerAddress(client)).toBe("12 Main Road, Unit 4, Fourways 2191");
    expect(formatCustomerAddress({ address: "Legacy 1" })).toBe("Legacy 1");
    expect(formatCustomerAddress({ primary_address_line1: "19 Amandel Close, Bellville 7530", city: "Bellville", postal_code: "7530" })).toBe("19 Amandel Close, Bellville 7530");
  });
  it("bills to the linked client, not the site", () => {
    const b = resolveBillTo({ customer: client, fallbackName: "x", fallbackAddress: "5 Site St" });
    expect(b).toEqual({ name: "Marina Botha", company: "Marina Holdings (Pty) Ltd", address: "12 Main Road, Unit 4, Fourways 2191", vat: "4123456789" });
  });
  it("uses the lead address when no client is linked", () => {
    expect(resolveBillTo({ customer: null, fallbackName: "Walk-in", fallbackAddress: "5 Site St" }).address).toBe("5 Site St");
  });
  it("shows Site only when it differs", () => {
    expect(siteLineFor("5 Site St", "12 Main Road")).toBe("5 Site St");
    expect(siteLineFor("12 main road", "12 Main Road, Fourways 2191")).toBeNull();
    expect(siteLineFor("", "x")).toBeNull();
    expect(siteLineFor("N/A", "x")).toBeNull();
  });
  it("brand document prints the Site line under bill-to", () => {
    render(<BrandDocument docType="invoice" captureRoot="invoice" title="TAX INVOICE" number="INV-1" partyLabel="Bill to" partyName="Marina Botha" partyLines={["Marina Holdings (Pty) Ltd", "12 Main Road"]} partySite="5 Site St" meta={[]} sections={[]} totals={[]} grandLabel="Total" grandTotal={0} cards={[]} />);
    expect(screen.getAllByTestId("party-site")[0].textContent).toContain("5 Site St");
  });
});
