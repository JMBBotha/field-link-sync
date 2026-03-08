import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Mark overdue
    await supabase.rpc("mark_overdue_maintenance");

    const today = new Date();
    const twoDaysFromNow = new Date(today);
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const todayStr = today.toISOString().split("T")[0];
    const twoDayStr = twoDaysFromNow.toISOString().split("T")[0];
    const sevenDayStr = sevenDaysFromNow.toISOString().split("T")[0];

    // 7-day reminders
    const { data: sevenDayDue } = await supabase
      .from("maintenance_schedules")
      .select(`
        id, due_date,
        customers:customer_id (name, phone),
        equipment:equipment_id (type, brand, model),
        service_agreements:agreement_id (contract_type)
      `)
      .eq("status", "upcoming")
      .eq("reminder_7d_sent", false)
      .gte("due_date", todayStr)
      .lte("due_date", sevenDayStr);

    let remindersSent = 0;

    for (const schedule of sevenDayDue || []) {
      const customer = schedule.customers as any;
      if (!customer?.phone) continue;

      const contractLabel = (schedule.service_agreements as any)?.contract_type || "maintenance";
      const equipInfo = schedule.equipment ? `${(schedule.equipment as any).brand || ""} ${(schedule.equipment as any).model || ""}`.trim() : "";

      // Queue WhatsApp notification
      await supabase.from("notification_queue").insert({
        customer_id: (schedule as any).customer_id || schedule.id,
        notification_type: "maintenance_reminder_7d",
        channel: "whatsapp",
        recipient_phone: customer.phone,
        subject: "Maintenance Reminder",
        body: `Hi ${customer.name}, your ${contractLabel}${equipInfo ? ` for your ${equipInfo}` : ""} is due on ${schedule.due_date}. Reply to book or call us to schedule.`,
        variables: { schedule_id: schedule.id, due_date: schedule.due_date },
      });

      await supabase
        .from("maintenance_schedules")
        .update({ reminder_7d_sent: true })
        .eq("id", schedule.id);

      remindersSent++;
    }

    // 2-day reminders
    const { data: twoDayDue } = await supabase
      .from("maintenance_schedules")
      .select(`
        id, due_date,
        customers:customer_id (name, phone),
        equipment:equipment_id (type, brand, model),
        service_agreements:agreement_id (contract_type)
      `)
      .eq("status", "upcoming")
      .eq("reminder_2d_sent", false)
      .gte("due_date", todayStr)
      .lte("due_date", twoDayStr);

    for (const schedule of twoDayDue || []) {
      const customer = schedule.customers as any;
      if (!customer?.phone) continue;

      const contractLabel = (schedule.service_agreements as any)?.contract_type || "maintenance";

      await supabase.from("notification_queue").insert({
        customer_id: (schedule as any).customer_id || schedule.id,
        notification_type: "maintenance_reminder_2d",
        channel: "whatsapp",
        recipient_phone: customer.phone,
        subject: "Maintenance Tomorrow",
        body: `Hi ${customer.name}, your ${contractLabel} service is due in 2 days (${schedule.due_date}). Please ensure access to the unit. Contact us to reschedule if needed.`,
        variables: { schedule_id: schedule.id, due_date: schedule.due_date },
      });

      await supabase
        .from("maintenance_schedules")
        .update({ reminder_2d_sent: true })
        .eq("id", schedule.id);

      remindersSent++;
    }

    // Auto-schedule next maintenance when a job is completed
    const { data: completedSchedules } = await supabase
      .from("maintenance_schedules")
      .select(`
        id, agreement_id, customer_id, equipment_id, due_date,
        service_agreements:agreement_id (frequency, end_date)
      `)
      .eq("status", "completed");

    let nextScheduled = 0;
    for (const cs of completedSchedules || []) {
      const freq = (cs.service_agreements as any)?.frequency || "annual";
      const intervalMonths = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : freq === "biannual" ? 6 : 12;
      const currentDue = new Date(cs.due_date);
      const nextDue = new Date(currentDue);
      nextDue.setMonth(nextDue.getMonth() + intervalMonths);
      const nextDueStr = nextDue.toISOString().split("T")[0];

      if (cs.service_agreements?.end_date && nextDueStr > cs.service_agreements.end_date) continue;

      // Check if next schedule already exists
      const { data: existing } = await supabase
        .from("maintenance_schedules")
        .select("id")
        .eq("agreement_id", cs.agreement_id)
        .eq("due_date", nextDueStr)
        .maybeSingle();

      if (!existing) {
        await supabase.from("maintenance_schedules").insert({
          agreement_id: cs.agreement_id,
          customer_id: cs.customer_id,
          equipment_id: cs.equipment_id,
          due_date: nextDueStr,
        });
        nextScheduled++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        reminders_sent: remindersSent,
        next_scheduled: nextScheduled,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("maintenance-reminders error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
