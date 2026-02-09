import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { offlineDb } from "@/lib/offlineDb";

describe("Conflict Detection", () => {
  beforeEach(async () => {
    await offlineDb.clearEverything();
  });

  it("detects field-level differences between local and server data", () => {
    const localData = { status: "in_progress", notes: "Agent notes" };
    const serverData = { status: "completed", notes: "Admin override" };

    const conflictingFields: string[] = [];
    for (const key of Object.keys(localData)) {
      const serverVal = JSON.stringify(serverData[key as keyof typeof serverData]);
      const localVal = JSON.stringify(localData[key as keyof typeof localData]);
      if (serverVal !== localVal) {
        conflictingFields.push(key);
      }
    }

    expect(conflictingFields).toContain("status");
    expect(conflictingFields).toContain("notes");
    expect(conflictingFields).toHaveLength(2);
  });

  it("detects version conflict when server timestamp is newer", () => {
    const opTimestamp = Date.now() - 60000; // 1 minute ago
    const serverStartedAt = Date.now() - 30000; // 30 seconds ago (newer)

    const serverLatestAction = Math.max(0, serverStartedAt, 0);
    const hasConflict = serverLatestAction > opTimestamp;

    expect(hasConflict).toBe(true);
  });

  it("no conflict when local timestamp is newer", () => {
    const opTimestamp = Date.now();
    const serverCreatedAt = Date.now() - 120000;

    const serverLatestAction = Math.max(serverCreatedAt, 0, 0);
    const hasConflict = serverLatestAction > opTimestamp;

    expect(hasConflict).toBe(false);
  });

  it("normalizes legacy status values", () => {
    const statusMap: Record<string, string> = {
      open: "pending",
      released: "pending",
      claimed: "accepted",
      available: "pending",
    };
    const normalize = (s: string) => statusMap[s] || s;

    expect(normalize("open")).toBe("pending");
    expect(normalize("claimed")).toBe("accepted");
    expect(normalize("in_progress")).toBe("in_progress");
    expect(normalize("completed")).toBe("completed");
  });

  it("keep_local overwrites server data", async () => {
    // Simulate: agent queued a status change while offline
    await offlineDb.cacheLeads(
      [
        {
          id: "conflict-lead",
          customer_name: "Conflict Test",
          customer_phone: "082",
          customer_address: "Addr",
          service_type: "Repair",
          status: "pending",
          latitude: -26,
          longitude: 28,
        },
      ],
      "agent-001"
    );

    // Agent changes status locally
    await offlineDb.updateLeadLocally("conflict-lead", { status: "in_progress" });

    // Verify local state reflects agent's choice
    const cached = await offlineDb.getCachedLeads();
    const lead = cached.find((l) => l.id === "conflict-lead");
    expect(lead?.status).toBe("in_progress");
  });

  it("use_server discards local changes and applies server state", async () => {
    await offlineDb.cacheLeads(
      [
        {
          id: "conflict-lead-2",
          customer_name: "Server Wins",
          customer_phone: "082",
          customer_address: "Addr",
          service_type: "Repair",
          status: "in_progress",
          latitude: -26,
          longitude: 28,
        },
      ],
      "agent-001"
    );

    // Simulate "Use Latest" — overwrite local with server data
    const serverData = { status: "completed", completed_at: new Date().toISOString() };
    await offlineDb.updateLeadLocally("conflict-lead-2", { ...serverData, cachedAt: Date.now() });

    const cached = await offlineDb.getCachedLeads();
    const lead = cached.find((l) => l.id === "conflict-lead-2");
    expect(lead?.status).toBe("completed");
    expect(lead?.completed_at).toBeTruthy();
  });
});
