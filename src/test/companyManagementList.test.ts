import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COMPANY_MANAGEMENT_SELECT, rowsFromCompanyListQuery } from "@/lib/companyManagementList";

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const IND = "7b0a1ac1-de4c-57c2-9274-49afe4344719";

describe("company management list", () => {
  it("uses the real select, including the lock flag", () => {
    expect(readFileSync("src/components/freshbooks/CompanyManagement.tsx", "utf8")).toContain("COMPANY_MANAGEMENT_SELECT");
    expect(COMPANY_MANAGEMENT_SELECT.split(", ").sort()).toEqual([
      "created_at",
      "custom_service_limit",
      "dormant_payments_locked",
      "id",
      "is_master",
      "logo_url",
      "name",
      "onboarding_completed",
      "services",
      "slug",
      "status",
      "updated_at",
      "vat_rate",
    ]);
    const grant = readFileSync("supabase/migrations/20261105233000_company_list_lock_column_grant.sql", "utf8");
    expect(grant).toMatch(/GRANT SELECT \(dormant_payments_locked\) ON public\.companies TO authenticated/);
  });

  it("returns active and archived rows, and throws when the query fails", () => {
    const rows = rowsFromCompanyListQuery({
      data: [
        { id: CT, name: "Massair CT", status: "active", dormant_payments_locked: false },
        { id: IND, name: "Massair Ind CC", status: "archived", dormant_payments_locked: false },
      ],
      error: null,
    });
    expect(rows.map((r) => r.status)).toEqual(["active", "archived"]);
    expect(() => rowsFromCompanyListQuery({
      data: null,
      error: { message: "permission denied for column dormant_payments_locked" },
    })).toThrow(/permission denied for column dormant_payments_locked/);
    expect(rowsFromCompanyListQuery({ data: [], error: null })).toEqual([]);
  });
});
