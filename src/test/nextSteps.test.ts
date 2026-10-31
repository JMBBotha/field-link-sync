import { describe, expect, it } from "vitest";
import { countByRule, sortSteps, waitingLabel, RULES, type NextStep } from "@/lib/nextSteps";

const row = (rule: NextStep["rule"], prio: number, since: string): NextStep =>
  ({ rule, prio, entity_type: "x", entity_id: rule + since, title: "Client A", detail: null, amount: null, since, owner_id: null, link: "/", snoozable: rule !== "new_lead" });

describe("next steps", () => {
  it("puts new leads first and oldest first within a rule", () => {
    const s = sortSteps([row("followup", 3, "2026-10-20"), row("new_lead", 1, "2026-10-31"), row("followup", 3, "2026-10-10")]);
    expect(s.map((r) => r.rule + r.since)).toEqual(["new_lead2026-10-31", "followup2026-10-10", "followup2026-10-20"]);
  });
  it("counts per rule in priority order", () => {
    expect(countByRule([row("cold", 4, "a"), row("new_lead", 1, "b"), row("cold", 4, "c")])).toEqual([{ rule: "new_lead", n: 1 }, { rule: "cold", n: 2 }]);
  });
  it("new leads are red, labels read well", () => {
    expect(RULES.new_lead.tone).toBe("red");
    expect(RULES.followup.chip(1)).toBe("1 follow-up");
    expect(waitingLabel(3)).toBe("3 min");
    expect(waitingLabel(3000)).toBe("2 days");
  });
});

import { urgency } from "@/lib/nextSteps";
describe("time urgency colours", () => {
  const now = new Date("2026-10-31T10:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("new lead: green 0-2 min, orange 2-5, red 5+", () => {
    expect(urgency({ rule: "new_lead", since: ago(60e3) }, now)).toBe("green");
    expect(urgency({ rule: "new_lead", since: ago(3 * 60e3) }, now)).toBe("orange");
    expect(urgency({ rule: "new_lead", since: ago(6 * 60e3) }, now)).toBe("red");
  });
  it("follow-up: green before day 5, orange 5-7, red after 7", () => {
    expect(urgency({ rule: "followup", since: ago(4 * 864e5) }, now)).toBe("green");
    expect(urgency({ rule: "followup", since: ago(6 * 864e5) }, now)).toBe("orange");
    expect(urgency({ rule: "followup", since: ago(8 * 864e5) }, now)).toBe("red");
  });
  it("technician: by days until install", () => {
    expect(urgency({ rule: "assign_tech", since: ago(-5 * 864e5) }, now)).toBe("green");
    expect(urgency({ rule: "assign_tech", since: ago(-2 * 864e5) }, now)).toBe("orange");
    expect(urgency({ rule: "assign_tech", since: ago(-0.5 * 864e5) }, now)).toBe("red");
  });
});
