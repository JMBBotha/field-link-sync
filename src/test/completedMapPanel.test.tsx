import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "fs";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => ({
          not: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import CompletedLeadsPanel from "@/components/CompletedLeadsPanel";
import { completedMapCards, type CompletedMapJob } from "@/lib/completedMapJobs";

const CT = "company-ct";
const hennie: CompletedMapJob = {
  id: "af49ca54-job", company_id: CT, status: "scheduled", completed_at: null,
  lead: { id: "0a0c1c34-lead", customer_name: "Hennie Matthee", service_type: "installation", company_id: CT, latitude: -33.9, longitude: 18.6 },
  assignee_ids: ["09a7f5af-innocent"],
};
const marina: CompletedMapJob = {
  id: "marina-job", company_id: CT, status: "completed", completed_at: "2026-11-01T08:00:00+02:00",
  lead: { id: "marina-lead", customer_name: "Marina", service_type: "installation", company_id: CT, customer_address: "1 Marina Road", latitude: -33.9, longitude: 18.4 },
  assignee_ids: ["assigned-not-completer"],
  completion: { status: "completed", completed_at: "2026-11-01T08:30:00+02:00", technician_id: "tech-marina", technician_name: "Completed Tech" },
};

describe("completed jobs panel", () => {
  it("shows only the finished job, opens that job, and still locates the lead", () => {
    const cards = completedMapCards({ jobs: [hennie, marina], companyId: CT });
    const open = vi.fn();
    const locate = vi.fn();
    render(<CompletedLeadsPanel cards={cards} isVisible onOpenJob={open} onLeadClick={locate} />);
    expect(screen.queryByText("Hennie Matthee")).toBeNull();
    expect(screen.getByText("1 completed")).toBeTruthy();
    expect(screen.getAllByText("Completed")).toHaveLength(1);
    expect(screen.getByText("Completed by: Completed Tech")).toBeTruthy();
    expect(screen.queryByText(/assigned-not-completer/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Marina" }));
    expect(open).toHaveBeenCalledWith("marina-job");
    expect(locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Locate" }));
    expect(locate).toHaveBeenCalledWith(-33.9, 18.4, "marina-lead");
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Marina" }).getAttribute("data-open-job")).toBe("marina-job");
  });

  it("the map page uses that job count for every Completed chip", () => {
    const page = readFileSync("src/pages/admin/AdminMapPage.tsx", "utf8");
    expect(page).toContain("fetchCompletedMapJobs");
    expect(page).toContain("withCompletedJobCount(statusState.counts, completedCards.length)");
    expect(page).not.toContain('counts={statusState.counts}');
    expect(page).toContain("onOpenJob={(id) => navigate(jobPath(id))}");
    expect(page).toContain("completedLeadIds={completedLeadIds}");
  });
});
