import { describe, it, expect } from "vitest";
import { statusText, priorityText } from "@/components/jobs/JobHeaderPills";
describe("job header pills", () => {
  it("plain stage", () => { expect(statusText("scheduled")[0]).toBe("Booked"); expect(statusText("in_progress")[0]).toBe("On site"); });
  it("priority", () => expect(priorityText("normal")).toBe("Normal priority"));
});
