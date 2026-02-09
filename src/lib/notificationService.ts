import { supabase } from "@/integrations/supabase/client";

export type NotificationType =
  | "job_assigned"
  | "tech_en_route"
  | "tech_arrived"
  | "job_completed"
  | "invoice_sent"
  | "payment_received"
  | "feedback_request";

interface NotificationVariables {
  tech_name?: string;
  eta?: string;
  tech_phone?: string;
  job_type?: string;
  invoice_number?: string;
  amount?: string;
  [key: string]: string | undefined;
}

/**
 * Send a WhatsApp notification to a customer
 */
export async function sendNotification(
  notificationType: NotificationType,
  customerId: string,
  variables: NotificationVariables = {},
  options?: {
    leadId?: string;
    invoiceId?: string;
  }
): Promise<{ success: boolean; message: string; queueId?: string }> {
  try {
    console.log('[Notification][Send] Triggering:', notificationType, 'customer:', customerId, 'vars:', variables);

    const { data, error } = await supabase.functions.invoke("send-whatsapp-notification", {
      body: {
        notification_type: notificationType,
        customer_id: customerId,
        lead_id: options?.leadId,
        invoice_id: options?.invoiceId,
        variables,
      },
    });

    if (error) {
      console.error("[Notification][Send] Edge function error:", error);
      return { success: false, message: error.message };
    }

    console.log('[Notification][Send] Response:', data);
    return {
      success: data?.success ?? false,
      message: data?.message ?? "Unknown response",
      queueId: data?.queue_id,
    };
  } catch (err: any) {
    console.error("[Notification][Send] Failed:", err);
    return { success: false, message: err.message || "Failed to send notification" };
  }
}

/**
 * Offline-aware notification sender:
 * If online, fires immediately. If offline, queues for later via Dexie sync queue.
 */
export function sendNotificationOfflineAware(
  isOnline: boolean,
  queueOperation: (type: string, table: string, id: string, data: any) => Promise<any>,
  notificationType: NotificationType,
  customerId: string,
  variables: NotificationVariables = {},
  options?: { leadId?: string; invoiceId?: string }
) {
  if (isOnline) {
    console.log('[Notification][OfflineAware] Online — sending immediately:', notificationType);
    sendNotification(notificationType, customerId, variables, options)
      .then(res => {
        if (!res.success) console.warn('[Notification][OfflineAware] Send returned failure:', res.message);
      })
      .catch(err => console.error('[Notification][OfflineAware] Error:', err));
  } else {
    console.log('[Notification][OfflineAware] Offline — queueing:', notificationType);
    queueOperation(
      'update_lead' as any, // reuse existing op type since we process it specially
      'notification_queue',
      `notif-${Date.now()}`,
      {
        _isNotification: true,
        notification_type: notificationType,
        customer_id: customerId,
        variables,
        lead_id: options?.leadId,
        invoice_id: options?.invoiceId,
      }
    ).catch(err => console.error('[Notification][OfflineAware] Queue error:', err));
  }
}

/**
 * Send job assigned notification
 */
export async function notifyJobAssigned(
  customerId: string,
  leadId: string,
  techName: string,
  eta?: string
) {
  return sendNotification(
    "job_assigned",
    customerId,
    {
      tech_name: techName,
      eta: eta || "within 2 hours",
    },
    { leadId }
  );
}

/**
 * Send tech en route notification
 */
export async function notifyTechEnRoute(
  customerId: string,
  leadId: string,
  techName: string,
  etaMinutes: number
) {
  return sendNotification(
    "tech_en_route",
    customerId,
    {
      tech_name: techName,
      eta: `${etaMinutes} minutes`,
    },
    { leadId }
  );
}

/**
 * Send tech arrived notification
 */
export async function notifyTechArrived(customerId: string, leadId: string) {
  return sendNotification("tech_arrived", customerId, {}, { leadId });
}

/**
 * Send job completed notification
 */
export async function notifyJobCompleted(
  customerId: string,
  leadId: string,
  invoiceId?: string
) {
  return sendNotification("job_completed", customerId, {}, { leadId, invoiceId });
}

/**
 * Send invoice notification
 */
export async function notifyInvoiceSent(
  customerId: string,
  invoiceId: string,
  invoiceNumber: string,
  amount: string
) {
  return sendNotification(
    "invoice_sent",
    customerId,
    {
      invoice_number: invoiceNumber,
      amount,
    },
    { invoiceId }
  );
}

/**
 * Send payment received notification
 */
export async function notifyPaymentReceived(customerId: string, invoiceId: string) {
  return sendNotification("payment_received", customerId, {}, { invoiceId });
}

/**
 * Send feedback request (typically 2 hours after job completion)
 */
export async function notifyFeedbackRequest(customerId: string, leadId: string) {
  return sendNotification("feedback_request", customerId, {}, { leadId });
}

/**
 * Process the notification queue (call from admin or cron)
 */
export async function processNotificationQueue(): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  try {
    console.log('[Notification][Queue] Processing queue...');
    const { data, error } = await supabase.functions.invoke("send-whatsapp-notification", {
      body: { process_queue: true },
    });

    if (error) {
      console.error("[Notification][Queue] Processing error:", error);
      return { processed: 0, sent: 0, failed: 0 };
    }

    console.log('[Notification][Queue] Result:', data);
    return {
      processed: data?.processed ?? 0,
      sent: data?.sent ?? 0,
      failed: data?.failed ?? 0,
    };
  } catch (err) {
    console.error("[Notification][Queue] Failed:", err);
    return { processed: 0, sent: 0, failed: 0 };
  }
}
