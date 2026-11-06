import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import JobsCalmView, { type CalmBlock, type CalmPerson } from "@/components/jobs/calm/JobsCalmView";
import { TechOnTheWayView } from "@/components/jobs/TechLocationBlock";
import type { JobTechLocation } from "@/lib/techLocation";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

const person = (id: string, name: string, role: string): CalmPerson => ({ id, name, role, dot: "blue" });
const install = (id: string, personId: string, title: string): CalmBlock => ({
  id, kind: "job", personId, day: "2026-11-06", start: 9 * 60 + 30, dur: 360,
  title, place: "Durbanville", block: "install",
});

function view(people: CalmPerson[], blocks: CalmBlock[], empty?: string) {
  const onOpenBlock = vi.fn();
  render(
    <JobsCalmView
      tab="today" onTab={() => {}} dateLabel="Fri 6 Nov" onNew={() => {}}
      leads={[]} leadsTotal={0} showAllLeads={false} onShowAll={() => {}}
      people={people} blocks={blocks} unassigned={[]}
      weekDays={[]} everyone="all" everyoneOptions={[{ value: "all", label: "Everyone ▾" }]} onEveryone={() => {}}
      chip={null} onChip={() => {}} counts={{ leadsNotContacted: 0, late: 0, unassigned: 0 }}
      onCallLead={() => {}} onAssignLead={() => {}} onOpenLead={() => {}}
      onAssignJob={() => {}} onOpenJob={() => {}} onOpenBlock={onOpenBlock}
      emptyJobsLabel={empty}
      renderJobExtra={(b) => <p data-testid="on-the-way-slot">On the way for {b.id}</p>}
    />,
  );
  return { onOpenBlock };
}

describe("sales Jobs today", () => {
  it("lists a technician installation the salesperson should see and opens the job", () => {
    const { onOpenBlock } = view(
      [person("tech", "Innocent", "Tech")],
      [install("af49ca54", "tech", "Installation · Hennie Matthee")],
    );
    expect(screen.getAllByText("Installation · Hennie Matthee").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Innocent").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("on-the-way-slot").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("Installation · Hennie Matthee")[0]);
    expect(onOpenBlock).toHaveBeenCalledWith(expect.objectContaining({ id: "af49ca54", kind: "job" }));
  });

  it("keeps Nothing booked when they truly have no jobs", () => {
    view([], [], "Nothing booked");
    expect(screen.getAllByText("Nothing booked").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("on-the-way-slot")).toBeNull();
  });
});

const base = (over: Partial<JobTechLocation> = {}): JobTechLocation => ({
  allowed: true, in_window: true, window_start: "2026-11-06T06:00:00Z", window_end: "2026-11-06T14:30:00Z",
  job_lat: -33.83, job_lng: 18.65, techs: [], ...over,
});

describe("technician on the way", () => {
  it("draws a pin only from a shared coordinate", () => {
    render(<TechOnTheWayView data={base({ techs: [{
      tech_id: "t", name: "Innocent", lat: -33.9, lng: 18.5, last_updated: "2026-11-06T07:00:00Z",
      distance_km: 8, status: "on_the_way", shared: true,
    }] })} />);
    expect(screen.getByTestId("tech-way-pin")).toBeInTheDocument();
    expect(screen.getByText("Innocent is on the way.")).toBeInTheDocument();
  });

  it("says the trip has not started and does not invent a pin", () => {
    render(<TechOnTheWayView data={base({ techs: [{
      tech_id: "t", name: "Innocent", lat: null, lng: null, last_updated: null,
      distance_km: null, status: "not_started", shared: false,
    }] })} />);
    expect(screen.getByText("Innocent has not started the trip.")).toBeInTheDocument();
    expect(screen.queryByTestId("tech-way-pin")).toBeNull();
  });

  it("says location is not shared when they are on the way without a fix", () => {
    render(<TechOnTheWayView data={base({ techs: [{
      tech_id: "t", name: "Innocent", lat: null, lng: null, last_updated: null,
      distance_km: null, status: "on_the_way", shared: false,
    }] })} />);
    expect(screen.getByText("Innocent is on the way, but is not sharing location. No pin to show.")).toBeInTheDocument();
    expect(screen.queryByTestId("tech-way-pin")).toBeNull();
  });

  it("says the window has not opened yet", () => {
    render(<TechOnTheWayView data={base({ in_window: false, window_start: "2099-01-01T06:00:00Z", window_end: "2099-01-01T16:00:00Z" })} />);
    expect(screen.getByTestId("tech-location-later").textContent).toMatch(/not shown yet/);
    expect(screen.queryByTestId("tech-way-pin")).toBeNull();
  });
});
