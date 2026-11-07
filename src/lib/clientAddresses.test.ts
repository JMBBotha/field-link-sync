import { describe, expect, it, vi } from "vitest";
import {
  applyLocationWrite,
  clientHeaderName,
  companyEntityPatch,
  companyNamePatch,
  initialHomeAddress,
  initialWorkFields,
  locationsToCreate,
  planLocationWrite,
  workBillingPatch,
} from "@/lib/clientAddresses";

const locations = [
  { id: "home", label: "home", address: "9 Oak Lane", is_primary: false },
  { id: "work", label: "Work", address: "1 Old Work Rd", is_primary: true },
  { id: "rent", label: "Rental", address: "5 Site Road", is_primary: false },
];

describe("client header and company patch", () => {
  it("shows the person when there is no company name, even if the company flag is on", () => {
    expect(clientHeaderName({ is_company: true, company_name: "  ", first_name: "Johan", last_name: "Botha" })).toBe("Johan Botha");
    expect(clientHeaderName({ is_company: false, company_name: "Botha Air", first_name: "Johan", last_name: "Botha" })).toBe("Johan Botha");
    expect(clientHeaderName({ is_company: true, company_name: "Botha Air", first_name: "Johan", last_name: "Botha" })).toBe("Botha Air");
  });

  it("company name save does not include private fields", () => {
    expect(companyNamePatch("  Botha Air  ")).toEqual({ company_name: "Botha Air", is_company: true });
    expect(companyNamePatch("")).toEqual({ company_name: null, is_company: false });
    expect(companyEntityPatch("Botha Air")).toEqual({ company_name: "Botha Air" });
    expect(companyEntityPatch("Botha Air")).not.toHaveProperty("name");
    expect(companyEntityPatch("Botha Air")).not.toHaveProperty("phone");
    expect(companyEntityPatch("Botha Air")).not.toHaveProperty("email");
    expect(companyEntityPatch("Botha Air")).not.toHaveProperty("is_company");
  });
});

describe("home and work locations", () => {
  it("reads Home and Work without using other labels", () => {
    expect(initialHomeAddress(locations)).toBe("9 Oak Lane");
    expect(initialWorkFields({ primary_address_line1: "14 Industry Road", city: "Cape Town", postal_code: "8001" }, locations)).toEqual({
      line1: "14 Industry Road", line2: "", city: "Cape Town", postal: "8001",
    });
    expect(initialWorkFields({}, [{ label: "Work", address: "Fallback Work" }])).toEqual({
      line1: "Fallback Work", line2: "", city: "", postal: "",
    });
  });

  it("work billing patch is only the address columns invoices use", () => {
    const patch = workBillingPatch({ line1: "14 Industry Road", line2: "Unit 3", city: "Cape Town", postal: "8001" });
    expect(patch).toEqual({
      primary_address_line1: "14 Industry Road",
      primary_address_line2: "Unit 3",
      city: "Cape Town",
      postal_code: "8001",
      address: "14 Industry Road, Unit 3, Cape Town, 8001",
    });
    for (const key of ["name", "phone", "email", "secondary_phone", "company_name", "vat_number"]) {
      expect(patch).not.toHaveProperty(key);
    }
  });

  it("updates Home or Work and leaves every other label alone", async () => {
    const update = vi.fn(async (_id: string, _patch: { label: string; address: string }) => {});
    const insert = vi.fn(async (_row: { label: string }) => {});
    const home = await applyLocationWrite({ update, insert }, {
      customerId: "c1", companyId: "co", kind: "Home", address: "12 New Home", locations,
    });
    expect(home).toMatchObject({ op: "update", id: "home", label: "Home", address: "12 New Home" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();

    update.mockClear();
    const work = await applyLocationWrite({ update, insert }, {
      customerId: "c1", companyId: "co", kind: "Work", address: "14 Industry Road, Cape Town, 8001", locations,
    });
    expect(work).toMatchObject({ op: "update", id: "work", label: "Work" });
    expect(update.mock.calls.map((c) => c[0])).toEqual(["work"]);
    expect(update.mock.calls.some((c) => c[0] === "rent" || c[0] === "home")).toBe(false);
  });

  it("inserts a missing Work row as the billing location and never deletes others", async () => {
    const insert = vi.fn(async () => {});
    const plan = await applyLocationWrite({ update: vi.fn(), insert }, {
      customerId: "c1", companyId: "co", kind: "Work", address: "14 Industry Road",
      locations: [{ id: "rent", label: "Rental", address: "5 Site Road", is_primary: true }],
    });
    expect(plan).toMatchObject({ op: "insert", label: "Work", is_primary: false });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ label: "Work", address: "14 Industry Road", is_primary: false }));
  });

  it("a new client can be private-only, or store both addresses", () => {
    expect(locationsToCreate({ customerId: "c1", companyId: "co", homeAddress: "", workAddress: "" })).toEqual([]);
    const rows = locationsToCreate({
      customerId: "c1", companyId: "co", homeAddress: "9 Oak Lane", workAddress: "14 Industry Road, Cape Town",
    });
    expect(rows.map((r) => r.label)).toEqual(["Work", "Home"]);
    expect(rows.find((r) => r.label === "Work")?.is_primary).toBe(true);
    expect(rows.find((r) => r.label === "Home")?.is_primary).toBe(false);
    expect(planLocationWrite({ kind: "Home", address: "", locations: [] })).toEqual({ op: "skip" });
  });
});
