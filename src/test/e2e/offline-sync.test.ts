import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { offlineDb, PendingOperation } from "@/lib/offlineDb";

describe("Offline Sync Queue", () => {
  beforeEach(async () => {
    await offlineDb.clearEverything();
  });

  it("queues operations when offline", async () => {
    await offlineDb.queueOperation({
      operationType: "update_lead",
      tableName: "leads",
      recordId: "lead-123",
      data: { status: "in_progress", started_at: new Date().toISOString() },
      timestamp: Date.now(),
    });

    const pending = await offlineDb.getPendingOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0].operationType).toBe("update_lead");
    expect(pending[0].synced).toBe(false);
  });

  it("queues photo uploads for later sync", async () => {
    const photoId = "photo-001";
    await offlineDb.savePhoto({
      id: photoId,
      leadId: "lead-123",
      base64Data: "data:image/jpeg;base64,/9j/4AAQ",
      fileName: "job-photo.jpg",
      mimeType: "image/jpeg",
      photoType: "before",
      capturedAt: Date.now(),
    });

    await offlineDb.queueOperation({
      operationType: "upload_photo",
      tableName: "job_photos",
      recordId: photoId,
      data: { uploaded_by: "agent-001" },
      timestamp: Date.now(),
    });

    const pendingPhotos = await offlineDb.getPendingPhotos();
    expect(pendingPhotos).toHaveLength(1);
    expect(pendingPhotos[0].id).toBe(photoId);

    const pendingOps = await offlineDb.getPendingOperations();
    expect(pendingOps.some((op) => op.operationType === "upload_photo")).toBe(true);
  });

  it("marks operations as synced after processing", async () => {
    await offlineDb.queueOperation({
      operationType: "update_lead",
      tableName: "leads",
      recordId: "lead-456",
      data: { status: "completed" },
      timestamp: Date.now(),
    });

    const pending = await offlineDb.getPendingOperations();
    expect(pending).toHaveLength(1);

    await offlineDb.markOperationSynced(pending[0].id!);

    const afterSync = await offlineDb.getPendingOperations();
    expect(afterSync).toHaveLength(0);
  });

  it("tracks retry counts on failure", async () => {
    await offlineDb.queueOperation({
      operationType: "create_invoice",
      tableName: "invoices",
      recordId: "inv-001",
      data: { grand_total: 5000 },
      timestamp: Date.now(),
    });

    const pending = await offlineDb.getPendingOperations();
    await offlineDb.updateOperationError(pending[0].id!, "Network error");

    const failed = await offlineDb.getFailedOperations();
    expect(failed).toHaveLength(1);
    expect(failed[0].retryCount).toBe(1);
    expect(failed[0].lastError).toBe("Network error");
  });

  it("returns correct pending counts by type", async () => {
    await offlineDb.queueOperation({
      operationType: "update_lead",
      tableName: "leads",
      recordId: "lead-1",
      data: {},
      timestamp: Date.now(),
    });
    await offlineDb.queueOperation({
      operationType: "upload_photo",
      tableName: "job_photos",
      recordId: "photo-1",
      data: {},
      timestamp: Date.now(),
    });
    await offlineDb.queueOperation({
      operationType: "upload_photo",
      tableName: "job_photos",
      recordId: "photo-2",
      data: {},
      timestamp: Date.now(),
    });

    const byType = await offlineDb.getPendingOperationsByType();
    expect(byType.update_lead).toBe(1);
    expect(byType.upload_photo).toBe(2);
    expect(byType.create_invoice).toBe(0);
  });

  it("clears failed operations", async () => {
    await offlineDb.queueOperation({
      operationType: "update_lead",
      tableName: "leads",
      recordId: "lead-fail",
      data: {},
      timestamp: Date.now(),
    });

    const pending = await offlineDb.getPendingOperations();
    await offlineDb.updateOperationError(pending[0].id!, "Server error");

    const cleared = await offlineDb.clearFailedOperations();
    expect(cleared).toBe(1);

    const remaining = await offlineDb.getFailedOperations();
    expect(remaining).toHaveLength(0);
  });
});

describe("Offline Timer Persistence", () => {
  beforeEach(async () => {
    await offlineDb.clearEverything();
  });

  it("saves and retrieves timer logs", async () => {
    const timerLog = {
      id: "timer-001",
      leadId: "lead-123",
      startedAt: Date.now() - 3600000,
      pausedAt: null,
      totalElapsedMs: 3600000,
      lastUpdatedAt: Date.now(),
      synced: false,
    };

    await offlineDb.saveTimerLog(timerLog);
    const retrieved = await offlineDb.getTimerLogForLead("lead-123");

    expect(retrieved).toBeDefined();
    expect(retrieved!.totalElapsedMs).toBe(3600000);
    expect(retrieved!.synced).toBe(false);
  });

  it("marks timer logs as synced", async () => {
    await offlineDb.saveTimerLog({
      id: "timer-002",
      leadId: "lead-456",
      startedAt: Date.now(),
      pausedAt: null,
      totalElapsedMs: 1800000,
      lastUpdatedAt: Date.now(),
      synced: false,
    });

    await offlineDb.markTimerLogSynced("timer-002");
    const pending = await offlineDb.getPendingTimerLogs();
    expect(pending).toHaveLength(0);
  });
});

describe("Offline Lead Cache", () => {
  beforeEach(async () => {
    await offlineDb.clearEverything();
  });

  it("caches and retrieves leads", async () => {
    const leads = [
      {
        id: "lead-1",
        customer_name: "Test Customer",
        customer_phone: "0821234567",
        customer_address: "123 Test St",
        service_type: "Repair",
        status: "pending",
        latitude: -26.2,
        longitude: 28.0,
      },
      {
        id: "lead-2",
        customer_name: "Another Customer",
        customer_phone: "0829876543",
        customer_address: "456 Other Ave",
        service_type: "Installation",
        status: "accepted",
        latitude: -26.3,
        longitude: 28.1,
      },
    ];

    await offlineDb.cacheLeads(leads, "agent-001");
    const cached = await offlineDb.getCachedLeads();

    expect(cached).toHaveLength(2);
    expect(cached.every((l) => l.cachedAt > 0)).toBe(true);
  });

  it("updates lead locally (optimistic update)", async () => {
    await offlineDb.cacheLeads(
      [
        {
          id: "lead-opt",
          customer_name: "Opt Customer",
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

    await offlineDb.updateLeadLocally("lead-opt", { status: "in_progress", started_at: new Date().toISOString() });

    const cached = await offlineDb.getCachedLeads();
    const updated = cached.find((l) => l.id === "lead-opt");
    expect(updated?.status).toBe("in_progress");
    expect(updated?.started_at).toBeTruthy();
  });
});
