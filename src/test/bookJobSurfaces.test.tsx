import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { BookJobForm, type PastDraft } from "@/components/jobs/BookJobForm";
import { defaultCompleted, workCards } from "@/lib/bookJobPath";
import type { JobKind } from "@/lib/jobTypeChoice";

const past = (over: Partial<PastDraft> = {}): PastDraft => ({
  techId: "t1", date: "2026-11-03", arrive: "08:00", leave: "11:30", note: "", completed: defaultCompleted("first_fix"), ...over,
});

function form(over: Partial<Parameters<typeof BookJobForm>[0]> = {}) {
  const doing = over.doing || "upcoming";
  const attached = over.attachedTitle;
  return render(
    <BookJobForm
      where={over.where || "single"}
      onWhere={() => {}}
      doing={doing}
      onDoing={() => {}}
      projects={[{ id: "p", name: "Avec" }]}
      projectId={over.projectId || ""}
      onProject={() => {}}
      houses={[{ id: "h", house_no: "12" }]}
      houseId={over.houseId || ""}
      onHouse={() => {}}
      clientLabel={over.clientLabel}
      projectHref={over.projectHref}
      attachedTitle={attached}
      cards={over.cards || workCards(doing, !!attached)}
      jobKind={(over.jobKind ?? null) as JobKind | null}
      onJobKind={() => {}}
      visitKind={over.visitKind ?? null}
      onVisitKind={() => {}}
      canLogPast={over.canLogPast ?? true}
      techs={[{ id: "t1", name: "Tech A" }]}
      past={over.past || past()}
      onPast={() => {}}
      visits={over.visits || []}
      correctId={null}
      onCorrect={() => {}}
      classic={over.classic}
    />,
  );
}

describe("Book a job surfaces", () => {
  it("shows the three choices and the two type cards on the default path", () => {
    form({ classic: <div>Schedule</div> });
    expect(screen.getByTestId("doing-upcoming")).toHaveTextContent("Book upcoming work");
    expect(screen.getByTestId("doing-past")).toHaveTextContent("Log work that already happened");
    expect(screen.getByTestId("doing-correct")).toHaveTextContent("Correct a visit later");
    expect(screen.getByTestId("job-kind-service")).toHaveTextContent("R680 excl. VAT");
    expect(screen.getByTestId("job-kind-installation")).toHaveTextContent("Free sales site visit");
    expect(screen.getByText("Schedule")).toBeInTheDocument();
  });

  it("shows an attached project house instead of a second sale", () => {
    form({ where: "project", projectId: "p", houseId: "h", clientLabel: "Demo client", attachedTitle: "Installation — Avec House 12", projectHref: "/admin/projects/p?house=h" });
    expect(screen.getByTestId("attached-job")).toHaveTextContent("No new sale and no second job");
    expect(screen.getByTestId("house-client")).toHaveTextContent("Demo client");
    expect(screen.getByTestId("open-house-link")).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("job-kind-service")).toBeNull();
    expect(screen.getByTestId("visit-kind-first_fix")).toBeInTheDocument();
  });

  it("shows the past-visit editor with today-or-earlier and finished off", () => {
    form({ doing: "past", visitKind: "first_fix", where: "project", projectId: "p", houseId: "h", attachedTitle: "Installation — Avec House 12" });
    expect(screen.getByTestId("past-date")).toHaveAttribute("max");
    expect(screen.getByTestId("past-tech")).toBeInTheDocument();
    expect(screen.getByTestId("past-arrive")).toBeInTheDocument();
    expect(screen.getByTestId("past-leave")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Whole job finished on this visit" })).toHaveAttribute("aria-checked", "false");
  });

  it("offers the same three choices from Book a job, the job page, and the project house", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    expect(read("src/components/jobs/CreateJobDialog.tsx")).toContain("BookJobForm");
    expect(read("src/components/jobs/BookJobForm.tsx")).toContain("WorkIntent");
    expect(read("src/pages/admin/AdminJobDetailPage.tsx")).toContain("LoggedWorkPanel");
    expect(read("src/components/projects/HouseDrawer.tsx")).toContain("LoggedWorkPanel");
    expect(read("src/components/jobs/LoggedWorkPanel.tsx")).toContain("WorkIntent");
    expect(read("src/components/jobs/LoggedWorkPanel.tsx")).toContain("PastVisitFields");
    expect(read("src/pages/admin/AdminJobDetailPage.tsx")).toContain("AdminBackfillPanel");
  });
});
