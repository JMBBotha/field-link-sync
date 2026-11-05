import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { activeCompanies, DORMANT_BADGE, isActiveCompany } from "@/lib/companyStatus";
import ArchivedCompanyBanner from "@/components/company/ArchivedCompanyBanner";

const migration = readFileSync("supabase/migrations/20261105120000_archived_company_dormant.sql", "utf8");
const rollback = readFileSync("supabase/manual/20261105120000_archived_company_dormant_rollback.sql", "utf8");

describe("dormant company status", () => {
  it("treats archived as hidden and active (or blank) as listed", () => {
    const rows = [
      { id: "a", status: "active" },
      { id: "b", status: "archived" },
      { id: "c", status: "on_hold" },
      { id: "d", status: null },
    ];
    expect(isActiveCompany(rows[0])).toBe(true);
    expect(isActiveCompany(rows[1])).toBe(false);
    expect(isActiveCompany(rows[2])).toBe(false);
    expect(activeCompanies(rows).map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("shows the history-only badge only for an archived company", () => {
    const { rerender } = render(<ArchivedCompanyBanner status="active" />);
    expect(screen.queryByTestId("archived-company-banner")).toBeNull();
    rerender(<ArchivedCompanyBanner status="archived" />);
    expect(screen.getByTestId("archived-company-banner").textContent).toContain(DORMANT_BADGE);
  });
});

describe("dormant company migration", () => {
  it("reuses archived, locks company writes, and keeps an open-invoice payment exception", () => {
    expect(migration).toMatch(/is_company_writable/);
    expect(migration).toMatch(/c\.status = 'active'/);
    expect(migration).not.toMatch(/status = 'dormant'/);
    expect(migration).toMatch(/AS RESTRICTIVE FOR INSERT/);
    expect(migration).toMatch(/archived_invoice_payment_ok/);
    expect(migration).toMatch(/confirm_dormant_payment_lock/);
    expect(migration).toMatch(/zz_dormant_company_write/);
    expect(migration).toMatch(/invoice_id/);
    expect(migration).toMatch(/entity_outbox/);
    expect(migration).toMatch(/use_shared_sequence/);
    expect(migration).toMatch(/candidate, false, 1, 4, true/);
    expect(migration).not.toMatch(/62326769075/);
    expect(migration).not.toMatch(/361bf031-9cdb-4d7f-9bde-9eb95fa4725e/);
  });

  it("ships a manual rollback that is not itself a migration", () => {
    expect(rollback.split("\n")[0]).toBe("-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION");
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS dormant_payments_locked/);
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS zz_dormant_company_write/);
  });
});
