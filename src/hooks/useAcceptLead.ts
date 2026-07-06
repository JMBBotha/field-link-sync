import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useToast } from "@/hooks/use-toast";
import { addMinutes, format, parse } from "date-fns";
import type { AppointmentValue } from "@/components/scheduling/AppointmentPicker";

export interface AcceptLeadInput {
  id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  service_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  priority?: string | null;
  notes?: string | null;
}

export interface AcceptLeadSubmit {
  appointment: AppointmentValue;
  title: string;
  description: string;
  priority: string;
  address: string;
  locationId?: string | null;
}

/**
 * Central accept-and-schedule flow used by every "Accept lead" surface.
 * Updates the lead, creates/updates the linked job, adds the assignment,
 * and writes to the activity log — in one atomic-ish sequence.
 */
export function useAcceptLead() {
  const { user } = useAuth();
  const { companyId } = useUserCompanyId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const acceptAndSchedule = async (
    lead: AcceptLeadInput,
    values: AcceptLeadSubmit,
  ): Promise<{ jobId: string } | null> => {
    if (!user) {
      toast({ title: "Not signed in", variant: "destructive" });
      return null;
    }
    if (!companyId) {
      toast({ title: "No company on profile", variant: "destructive" });
      return null;
    }

    const { appointment, title, description, priority, address, locationId } = values;
    if (!appointment.date || !appointment.startTime) {
      toast({ title: "Pick a date and time", variant: "destructive" });
      return null;
    }

    setSubmitting(true);
    try {
      const startDate = parse(
        `${appointment.date} ${appointment.startTime}`,
        "yyyy-MM-dd HH:mm",
        new Date(),
      );
      const endDate = addMinutes(startDate, appointment.durationMinutes);
      const scheduledIso = startDate.toISOString();
      const endHhmm = format(endDate, "HH:mm");
      const durationInterval = `${appointment.durationMinutes} minutes`;

      // 1) Update lead → accepted + scheduling metadata
      const leadPatch: Record<string, any> = {
        status: "accepted",
        assigned_agent_id: appointment.agentId || null,
        scheduled_date: appointment.date,
        scheduled_time: appointment.startTime,
        estimated_duration_minutes: appointment.durationMinutes,
        estimated_end_time: endHhmm,
        accepted_at: new Date().toISOString(),
      };
      const { error: leadErr } = await supabase
        .from("leads")
        .update(leadPatch)
        .eq("id", lead.id);
      if (leadErr) throw leadErr;

      // 2) Find or create the linked job
      const { data: existingJob } = await supabase
        .from("jobs")
        .select("id")
        .eq("lead_id", lead.id)
        .maybeSingle();

      let jobId = existingJob?.id as string | undefined;

      const jobPatch: Record<string, any> = {
        title,
        description: description || null,
        address: address || lead.customer_address || null,
        lat: lead.latitude ?? null,
        lng: lead.longitude ?? null,
        priority,
        scheduled_for: scheduledIso,
        estimated_duration: durationInterval,
        status: "scheduled",
        location_id: locationId || null,
      };

      if (jobId) {
        const { error: updErr } = await supabase
          .from("jobs")
          .update(jobPatch)
          .eq("id", jobId);
        if (updErr) throw updErr;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("jobs")
          .insert({
            ...jobPatch,
            company_id: companyId,
            customer_id: lead.customer_id || null,
            lead_id: lead.id,
            created_by: user.id,
            job_type: lead.service_type || "service_call",
          } as any)
          .select("id")
          .single();
        if (insErr) throw insErr;
        jobId = inserted.id;
      }

      // 3) Assignment (only when technician chosen)
      if (appointment.agentId && jobId) {
        const { data: existingAssign } = await supabase
          .from("assignments")
          .select("id")
          .eq("job_id", jobId)
          .eq("profile_id", appointment.agentId)
          .maybeSingle();

        if (existingAssign) {
          await supabase
            .from("assignments")
            .update({ status: "accepted", assigned_by: user.id })
            .eq("id", existingAssign.id);
        } else {
          await supabase.from("assignments").insert({
            job_id: jobId,
            profile_id: appointment.agentId,
            assigned_by: user.id,
            status: "accepted",
            assignment_type: "manual",
          });
        }
      }

      // 4) Activity log (best-effort)
      if (jobId) {
        await supabase.from("job_activity_log").insert({
          job_id: jobId,
          user_id: user.id,
          action: "accepted_and_scheduled",
          details: {
            lead_id: lead.id,
            scheduled_for: scheduledIso,
            agent_id: appointment.agentId || null,
          },
        });
      }

      // 5) Refresh caches
      const keys = [
        ["leads"],
        ["lead", lead.id],
        ["jobs-list"],
        ["jobs-map"],
        ["my-jobs"],
        ["job-schedules"],
        ["dispatch"],
      ];
      keys.forEach((k) => queryClient.invalidateQueries({ queryKey: k as any }));

      toast({
        title: "Lead accepted & scheduled",
        description: `${title} on ${format(startDate, "EEE dd MMM, HH:mm")}`,
      });

      return { jobId: jobId! };
    } catch (err: any) {
      console.error("[useAcceptLead] failed:", err);
      toast({
        title: "Couldn't accept lead",
        description: err?.message || "Please try again",
        variant: "destructive",
      });
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  return { acceptAndSchedule, submitting };
}
