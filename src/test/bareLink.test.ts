import { describe, it, expect } from "vitest";
import { bareUuid } from "@/lib/bareLink";
describe("bareUuid", () => {
  it("matches a bare uuid path", () => expect(bareUuid("/E2FCC112-528a-4dde-a5b6-f7a336dbf9aa/")).toBe("e2fcc112-528a-4dde-a5b6-f7a336dbf9aa"));
  it("ignores normal routes", () => { expect(bareUuid("/customer/e2fcc112-528a-4dde-a5b6-f7a336dbf9aa")).toBeNull(); expect(bareUuid("/admin")).toBeNull(); });
});
