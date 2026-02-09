import { describe, it, expect, vi, beforeEach } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";
import { sendNotification, sendNotificationOfflineAware } from "@/lib/notificationService";
import { offlineDb } from "@/lib/offlineDb";

describe("Notification Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notification via edge function", async () => {
    mockSupabase.functions.invoke.mockResolvedValueOnce({
      data: { success: true, message: "Sent", queue_id: "q-1" },
      error: null,
    });

    const result = await sendNotification("job_assigned", "customer-1", {
      tech_name: "John",
      eta: "30 minutes",
    });

    expect(result.success).toBe(true);
    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
      "send-whatsapp-notification",
      expect.objectContaining({
        body: expect.objectContaining({
          notification_type: "job_assigned",
          customer_id: "customer-1",
        }),
      })
    );
  });

  it("handles edge function errors gracefully", async () => {
    mockSupabase.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "Function timeout" },
    });

    const result = await sendNotification("tech_en_route", "customer-2", {});
    expect(result.success).toBe(false);
    expect(result.message).toBe("Function timeout");
  });

  it("queues notification when offline", async () => {
    await offlineDb.clearEverything();
    const mockQueue = vi.fn().mockResolvedValue(undefined);

    sendNotificationOfflineAware(
      false, // offline
      mockQueue,
      "job_completed",
      "customer-3",
      {},
      { leadId: "lead-5" }
    );

    expect(mockQueue).toHaveBeenCalledWith(
      "update_lead",
      "notification_queue",
      expect.stringContaining("notif-"),
      expect.objectContaining({
        _isNotification: true,
        notification_type: "job_completed",
        customer_id: "customer-3",
      })
    );
  });

  it("sends immediately when online", async () => {
    mockSupabase.functions.invoke.mockResolvedValueOnce({
      data: { success: true },
      error: null,
    });

    const mockQueue = vi.fn();

    sendNotificationOfflineAware(
      true, // online
      mockQueue,
      "tech_arrived",
      "customer-4",
      {},
      { leadId: "lead-6" }
    );

    // Should NOT queue
    expect(mockQueue).not.toHaveBeenCalled();
  });
});
