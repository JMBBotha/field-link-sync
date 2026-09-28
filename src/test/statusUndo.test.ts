import { describe, it, expect } from "vitest";
import {
  pushEntry, peekEntry, removeEntry, isStale, buildRevertPatch, buildRevertLog, describeEntry,
  recordStatusChange, readStack, clearAllStacks, undoKey, UNDO_LIMIT, type StatusUndoEntry,
} from "@/lib/statusUndo";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k),
    get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
};
const e = (o: Partial<StatusUndoEntry> = {}): StatusUndoEntry => ({ id: "1", entity_type: "quote", entity_id: "q1", field: "status", old_value: "sent", new_value: "accepted", company_id: "c1", label: "Q-1234", at: "", ...o });

describe("stack", () => {
  it("push/peek/remove and limit", () => {
    let s: StatusUndoEntry[] = [];
    for (let i = 0; i < 25; i++) s = pushEntry(s, e({ id: String(i) }));
    expect(s.length).toBe(UNDO_LIMIT);
    expect(peekEntry(s)!.id).toBe("24");
    expect(peekEntry(removeEntry(s, "24"))!.id).toBe("23");
  });
  it("record per user + clear on sign-out; no-op changes skipped", () => {
    const kv = mem();
    recordStatusChange("u1", { entity_type: "job", entity_id: "j", field: "status", old_value: "scheduled", new_value: "completed" }, kv);
    expect(recordStatusChange("u1", { entity_type: "job", entity_id: "j", field: "status", old_value: "x", new_value: "x" }, kv)).toBeNull();
    expect(readStack("u1", kv).length).toBe(1);
    expect(readStack("u2", kv).length).toBe(0);
    kv.setItem("other", "keep");
    clearAllStacks(kv);
    expect(kv.getItem(undoKey("u1"))).toBeNull();
    expect(kv.getItem("other")).toBe("keep");
  });
});

describe("revert", () => {
  it("stale check blocks when value changed since", () => {
    expect(isStale("accepted", e())).toBe(false);
    expect(isStale("declined", e())).toBe(true);
  });
  it("patch restores field + extras", () => {
    expect(buildRevertPatch(e({ extra_restore: { accepted_at: null, accepted_by: null, declined_at: null } })))
      .toEqual({ status: "sent", accepted_at: null, accepted_by: null, declined_at: null });
  });
  it("log row swaps old/new", () => {
    expect(buildRevertLog(e(), "me")).toEqual({ entity_type: "quote", entity_id: "q1", field_name: "status", old_status: "accepted", new_status: "sent", changed_by: "me", company_id: "c1" });
  });
  it("leads are never logged here (trigger does it)", () => {
    expect(buildRevertLog(e({ entity_type: "lead" }), "me")).toBeNull();
  });
  it("label", () => { expect(describeEntry(e())).toBe("Undo: Q-1234 accepted → sent"); });
});
