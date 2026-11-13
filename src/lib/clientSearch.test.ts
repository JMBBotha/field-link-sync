import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  clientMatchesSearch,
  clientSearchHaystack,
  filterClients,
  inCompanyClientScope,
  normalizePhoneDigits,
  type ClientSearchFields,
} from "@/lib/clientSearch";
import { clientChoices } from "@/components/quoting/QuoteClientDialog";

const CT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const IND = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** The live row: "Josh" exists only in the email. */
const pge: ClientSearchFields & { id: string; company_id: string; status: string | null } = {
  id: "02790513-dee6-40e6-8018-600963f6eb40",
  company_id: CT,
  name: "PGE Construction (Pty) Ltd",
  company_name: "PGE Construction (Pty) Ltd",
  first_name: null,
  last_name: null,
  email: "Josh@pgeconstruction.co.za",
  normalized_email: "josh@pgeconstruction.co.za",
  phone: "+27 71 050 8302",
  normalized_phone: "0710508302",
  search_aliases: [],
  status: "active",
};

const indHistory = {
  ...pge,
  id: "ind-history-1",
  company_id: IND,
  name: "Josh Supplies (Massair Ind CC)",
  company_name: "Josh Supplies (Massair Ind CC)",
  email: "josh@ind.example",
  normalized_email: "josh@ind.example",
  status: "active",
};

describe("normalizePhoneDigits", () => {
  it("follows the South African 27 / 0 rules used in the database", () => {
    expect(normalizePhoneDigits("+27 71 050 8302")).toBe("0710508302");
    expect(normalizePhoneDigits("071 050 8302")).toBe("0710508302");
    expect(normalizePhoneDigits("0710508302")).toBe("0710508302");
    expect(normalizePhoneDigits("710508302")).toBe("0710508302");
    expect(normalizePhoneDigits("Josh")).toBe("");
  });
});

describe("client search matching", () => {
  it("finds PGE Construction from Josh in the email only", () => {
    for (const q of ["Josh", "josh", "JOSH", "josh@pge", "pgeconstruction"]) {
      expect(clientMatchesSearch(pge, q), q).toBe(true);
    }
  });

  it("matches the company name and the name column when first and last are empty", () => {
    expect(clientMatchesSearch(pge, "PGE")).toBe(true);
    expect(clientMatchesSearch(pge, "construction")).toBe(true);
    expect(clientMatchesSearch(pge, "pty")).toBe(true);
  });

  it("matches first and last name even when the header name is the company", () => {
    const row = { ...pge, is_company: true, first_name: "Thandi", last_name: "Mokoena" };
    expect(clientMatchesSearch(row, "thandi")).toBe(true);
    expect(clientMatchesSearch(row, "mokoena")).toBe(true);
    expect(clientMatchesSearch(row, "thandi mokoena")).toBe(true);
  });

  it("matches formatted and normalised phone, including +27 and spaced digits", () => {
    for (const q of ["0710508302", "071 050 8302", "+27 71 050 8302", "+27710508302", "710508302", "71 050 8302", "8302"]) {
      expect(clientMatchesSearch(pge, q), q).toBe(true);
    }
  });

  it("matches a secondary phone and a search alias, case-insensitive and partial", () => {
    const row = { ...pge, secondary_phone: "021 555 0199", search_aliases: ["Site Josh", "PGE yard"] };
    expect(clientMatchesSearch(row, "0215550199")).toBe(true);
    expect(clientMatchesSearch(row, "555 0199")).toBe(true);
    expect(clientMatchesSearch(row, "site josh")).toBe(true);
    expect(clientMatchesSearch(row, "YARD")).toBe(true);
  });

  it("does not match an unrelated client", () => {
    expect(clientMatchesSearch(pge, "acme")).toBe(false);
    expect(clientMatchesSearch(pge, "0821234567")).toBe(false);
    expect(clientMatchesSearch({ name: "Other", phone: "082 000 0000", email: "a@b.c", search_aliases: [] }, "josh")).toBe(false);
  });

  it("keeps address search that the lead typeahead already had", () => {
    expect(clientMatchesSearch({ name: "Sipho Ndlovu", phone: "0821112222", address: "12 Oak St, Sandton" }, "sandton")).toBe(true);
    expect(clientMatchesSearch({ name: "Sipho Ndlovu", phone: "0821112222" }, "s")).toBe(true);
  });

  it("puts email, alias, and both phone digit forms on the search haystack", () => {
    const hay = clientSearchHaystack({ ...pge, search_aliases: ["Site Josh"] }).toLowerCase();
    expect(hay).toContain("josh@pgeconstruction.co.za");
    expect(hay).toContain("0710508302");
    expect(hay).toContain("27710508302");
    expect(hay).toContain("site josh");
  });
});

describe("company scope", () => {
  it("drops another company's clients, including Massair Ind CC history, from a Massair CT search", () => {
    expect(inCompanyClientScope(pge, CT, false)).toBe(true);
    expect(inCompanyClientScope(indHistory, CT, false)).toBe(false);
    expect(inCompanyClientScope({ ...indHistory, status: "archived" }, CT, true)).toBe(false);
    const visible = [pge, indHistory].filter((row) => inCompanyClientScope(row, CT, false));
    expect(filterClients(visible, "josh").map((row) => row.id)).toEqual([pge.id]);
  });

  it("hides archived clients on the live list and shows them only on the archived list", () => {
    const archived = { ...pge, status: "archived" };
    expect(inCompanyClientScope(archived, CT, false)).toBe(false);
    expect(inCompanyClientScope(archived, CT, true)).toBe(true);
    expect(inCompanyClientScope({ ...pge, status: null }, CT, false)).toBe(true);
  });

  it("does not treat a missing company id as permission to keep foreign rows once the company is known", () => {
    expect(inCompanyClientScope({ company_id: null, status: "active" }, CT, false)).toBe(false);
    expect(inCompanyClientScope({ company_id: null, status: "active" }, null, false)).toBe(true);
  });
});

describe("quote client picker", () => {
  it("returns PGE when the quote search is Josh", () => {
    const choices = clientChoices([
      { id: pge.id, customer_id: pge.id, name: pge.name, phone: pge.phone, email: pge.email, company_name: pge.company_name, normalized_phone: pge.normalized_phone, search_aliases: [] },
      { id: "lead-1", name: "Josh Lead", phone: "0820000000", email: "josh-lead@example.com" },
    ], "Josh");
    expect(choices.map((c) => c.id)).toEqual([pge.id]);
    expect(choices[0].name).toBe("PGE Construction (Pty) Ltd");
  });
});

describe("search surfaces use the shared directory", () => {
  const src = (path: string) => readFileSync(path, "utf8");

  it("clients list, quote, invoice, book a job, and global search share the matcher", () => {
    expect(src("src/pages/admin/AdminCustomersPage.tsx")).toContain("useCompanyClients");
    expect(src("src/pages/admin/AdminCustomersPage.tsx")).toContain("filterClients");
    expect(src("src/pages/admin/AdminCustomersPage.tsx")).not.toContain(".limit(500)");
    expect(src("src/hooks/useUnifiedClients.ts")).toContain("useCompanyClients");
    expect(src("src/pages/admin/AdminQuoteBuilderPageUnified.tsx")).toContain("filterClients");
    expect(src("src/components/quoting/QuoteClientDialog.tsx")).toContain("filterClients");
    expect(src("src/components/invoicing/CreateInvoicePage.tsx")).toContain("useCompanyClients");
    expect(src("src/components/invoicing/CreateInvoicePage.tsx")).toContain("filterClients");
    expect(src("src/components/jobs/CreateJobDialog.tsx")).toContain("useCompanyClients");
    expect(src("src/components/jobs/CreateJobDialog.tsx")).toContain("filterClients");
    expect(src("src/components/jobs/CreateJobDialog.tsx")).toContain("book-client-search");
    expect(src("src/components/GlobalSearchDialog.tsx")).toContain("useCompanyClients");
    expect(src("src/components/GlobalSearchDialog.tsx")).toContain("clientMatchesSearch");
    expect(src("src/lib/clientSearch.ts")).not.toContain("company_history_customers");
  });
});
