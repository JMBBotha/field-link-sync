import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { BookJobForm, type PastDraft } from "@/components/jobs/BookJobForm";
import { defaultCompleted, workCards } from "@/lib/bookJobPath";
import type { JobKind } from "@/lib/jobTypeChoice";

const past = (over: Partial<PastDraft> = {}): PastDraft => ({
  techId: "t1", date: "2026-11-03", arrive: "08:00", leave: "11:30", note: "", completed: defaultCompleted(["first_fix"]), ...over,
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
      houses={over.houses || [{ id: "h", house_no: "12" }]}
      houseId={over.houseId || ""}
      onHouse={() => {}}
      clientLabel={over.clientLabel}
      projectHref={over.projectHref}
      attachedTitle={attached}
      cards={over.cards || workCards(doing, !!attached)}
      jobKind={(over.jobKind ?? null) as JobKind | null}
      onJobKind={() => {}}
      visitKinds={over.visitKinds ?? []}
      onVisitKinds={() => {}}
      customLabel={over.customLabel}
      kindsOpen={over.kindsOpen}
      canLogPast={over.canLogPast ?? true}
      techs={over.techs || [{ id: "t1", name: "Tech A" }]}
      techsOpen={over.techsOpen}
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
    expect(screen.getByTestId("doing-correct")).toHaveTextContent("Update existing visit");
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
    expect(screen.getByTestId("visit-kind-menu")).toHaveTextContent("Choose the work");
  });

  it("opens a multi-select list and keeps a combination", () => {
    form({
      doing: "past", where: "project", projectId: "p", houseId: "h", attachedTitle: "Installation — Avec House 12",
      kindsOpen: true, visitKinds: ["first_fix", "piping"],
    });
    for (const label of ["First fix", "Piping", "AC installation", "Commission", "Warranty visit", "Repair", "Service", "Custom"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const labels = screen.getAllByTestId(/visit-kind-/).map((el) => el.textContent || "");
    expect(labels[labels.length - 1]).toContain("Custom");
    expect(screen.getByTestId("visit-kind-first_fix").querySelector("input")).toBeChecked();
    expect(screen.getByTestId("visit-kind-piping").querySelector("input")).toBeChecked();
    expect(screen.getByTestId("visit-kind-repair").querySelector("input")).not.toBeChecked();
    expect(screen.getByTestId("visit-kind-menu")).toHaveTextContent("First fix + Piping");
  });

  it("asks for a name when Custom is ticked and shows that name in the summary", () => {
    form({
      doing: "past", where: "project", projectId: "p", houseId: "h", attachedTitle: "Installation — Avec House 12",
      kindsOpen: true, visitKinds: ["first_fix", "custom"], customLabel: "Balcony drain",
    });
    expect(screen.getByTestId("visit-custom")).toHaveValue("Balcony drain");
    expect(screen.getByTestId("visit-kind-menu")).toHaveTextContent("First fix + Balcony drain");
    expect(screen.getByTestId("visit-kind-custom").querySelector("input")).toBeChecked();
  });

  it("shows the past-visit editor with today-or-earlier and finished off", () => {
    form({ doing: "past", visitKinds: ["first_fix", "piping"], where: "project", projectId: "p", houseId: "h", attachedTitle: "Installation — Avec House 12" });
    expect(screen.getByTestId("past-date")).toHaveAttribute("max");
    expect(screen.getByTestId("past-tech")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tech A" })).toBeInTheDocument();
    expect(screen.getByTestId("past-arrive")).toBeInTheDocument();
    expect(screen.getByTestId("past-leave")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Whole job finished on this visit" })).toHaveAttribute("aria-checked", "false");
  });

  it("shows every company technician in the past-work menu, including when the list is open", () => {
    form({
      doing: "past",
      visitKinds: ["first_fix"],
      techs: [{ id: "innocent", name: "Innocent Mattienga" }, { id: "t2", name: "Tech B" }],
      techsOpen: true,
      past: past({ techId: "" }),
    });
    const menu = screen.getByTestId("past-tech");
    expect(menu).toHaveAttribute("size", "3");
    expect(screen.getByRole("option", { name: "Choose technician…" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Innocent Mattienga" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tech B" })).toBeInTheDocument();
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

  it("lists project houses in natural numeric order", () => {
    form({
      where: "project",
      projectId: "p",
      houses: [
        { id: "h54", house_no: "54" },
        { id: "h55", house_no: "55" },
        { id: "h4", house_no: "4" },
        { id: "h8", house_no: "8" },
        { id: "h21", house_no: "21" },
        { id: "h22", house_no: "22" },
        { id: "h1", house_no: "1" },
        { id: "h6", house_no: "6" },
      ],
    });
    const house = screen.getByTestId("book-house");
    expect([...house.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Choose house…", "House 1", "House 4", "House 6", "House 8", "House 21", "House 22", "House 54", "House 55",
    ]);
  });
});
