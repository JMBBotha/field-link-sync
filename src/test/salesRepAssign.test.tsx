import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { activeCompanyStaff, salesRepCandidates, type StaffPickRow } from "@/lib/salesRepAssign";
import { SalesRepList } from "@/components/jobs/AssignSalesRepDialog";
import AssignSalesRepDialog from "@/components/jobs/AssignSalesRepDialog";

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const OTHER = "00000000-0000-4000-8000-000000000099";

const rows: StaffPickRow[] = [
  { id: "f7503c66", full_name: "Almari Cloete", company_id: CT, dispatch_role: "sales", participant_type: "staff", dispatch_active: true, archived_at: null },
  { id: "paused", full_name: "Paused Sales", company_id: CT, dispatch_role: "sales", dispatch_active: false, archived_at: null },
  { id: "gone", full_name: "Archived Sales", company_id: CT, dispatch_role: "sales", dispatch_active: true, archived_at: "2026-01-01" },
  { id: "tech", full_name: "Innocent Tech", company_id: CT, dispatch_role: "technician", dispatch_active: true, archived_at: null },
  { id: "ind", full_name: "Indie Sales", company_id: CT, dispatch_role: "sales", participant_type: "independent_tech", dispatch_active: true, archived_at: null },
  { id: "other", full_name: "Other Co Sales", company_id: OTHER, dispatch_role: "sales", dispatch_active: true, archived_at: null },
  { id: "eng", full_name: "Engineer Rep", company_id: CT, dispatch_role: "sales_engineer", dispatch_active: true, archived_at: null },
];

describe("sales rep picker filtering", () => {
  it("keeps active same-company sales staff and drops techs, paused, archived, and other companies", () => {
    expect(salesRepCandidates(rows, CT).map((r) => r.name)).toEqual(["Almari Cloete", "Engineer Rep"]);
    expect(salesRepCandidates(rows, null)).toEqual([]);
    expect(salesRepCandidates(null, CT)).toEqual([]);
  });

  it("Assigned To keeps every active same-company person, including technicians", () => {
    expect(activeCompanyStaff(rows, CT).map((r) => r.name)).toEqual([
      "Almari Cloete",
      "Engineer Rep",
      "Indie Sales",
      "Innocent Tech",
    ]);
  });

  it("shows Almari Cloete in the open picker and not a technician", () => {
    render(<SalesRepList reps={salesRepCandidates(rows, CT)} value="f7503c66" onChange={() => {}} />);
    expect(screen.getByRole("option", { name: "Almari Cloete" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Engineer Rep" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Innocent Tech" })).toBeNull();
    expect(screen.queryByText("Paused Sales")).toBeNull();
  });

  it("opens Assign rep with the salesperson list and no visit time", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AssignSalesRepDialog
          lead={{ id: "lead-1", customer_name: "Munirah Botha", company_id: CT }}
          reps={salesRepCandidates(rows, CT)}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Assign rep" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Almari Cloete" })).toBeInTheDocument();
    expect(screen.getByText(/No visit time/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Date")).toBeNull();
  });
});

describe("assign_sales_lead guard", () => {
  const sql = readFileSync("supabase/migrations/20261119121000_assign_sales_lead.sql", "utf8");

  it("checks office caller, active same-company sales staff, logs, and does not bypass triggers", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path TO 'public'");
    expect(sql).toContain("public._lead_office(v_uid, l.company_id)");
    expect(sql).toContain("l.primary_intent IS DISTINCT FROM 'sales'");
    expect(sql).toContain("p.company_id = l.company_id");
    expect(sql).toContain("p.archived_at IS NULL");
    expect(sql).toContain("p.dispatch_active IS TRUE");
    expect(sql).toContain("p.dispatch_role IN ('sales', 'sales_engineer')");
    expect(sql).toContain("COALESCE(p.participant_type, '') <> 'independent_tech'");
    expect(sql).toContain("INSERT INTO public.lead_assignment_log");
    expect(sql).toContain("tech_id, previous_agent_id, assigned_by, by_role");
    expect(sql).toContain("'office'");
    expect(sql).toMatch(/UPDATE public\.leads\s+SET assigned_agent_id = p_rep_id/);
    expect(sql).not.toMatch(/scheduled_date/);
    expect(sql).not.toMatch(/session_replication_role/i);
    expect(sql).not.toMatch(/DISABLE TRIGGER/i);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.assign_sales_lead(uuid, uuid) FROM PUBLIC, anon");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.assign_sales_lead(uuid, uuid) TO authenticated");
  });

  it("wires the dispatch action, the dialog, the details row, and the Assigned To filter", () => {
    const page = readFileSync("src/pages/admin/AdminDispatchPage.tsx", "utf8");
    const dialog = readFileSync("src/components/jobs/LeadAssignDialog.tsx", "utf8");
    const details = readFileSync("src/components/leads/LeadPageC.tsx", "utf8");
    const form = readFileSync("src/components/entity/EntityDetailsForm.tsx", "utf8");
    expect(page).toContain("Book free quote visit");
    expect(page).toContain("Assign rep");
    expect(page).toContain("Reassign rep");
    expect(page).toContain("AssignSalesRepDialog");
    expect(dialog).toContain("assign_sales_lead");
    expect(dialog).toContain("Technicians are assigned to service leads only.");
    expect(dialog).toContain("lead-assign-sales");
    expect(details).toContain('k="Assigned to"');
    expect(form).toContain("activeCompanyStaff");
    expect(form).toContain("dispatch_active");
    expect(form).toContain(".eq(\"company_id\", companyId!)");
  });
});
