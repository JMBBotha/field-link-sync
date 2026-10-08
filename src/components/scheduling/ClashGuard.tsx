import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { clashSummary, isAfterHours, type ClashRow } from "@/lib/clash";
import { hhmm, toMinutes, WORK_END, WORK_START } from "@/lib/schedulingDefaults";

export type ConfirmBookingArgs = {
  profileId: string;
  date: string; // YYYY-MM-DD (SAST)
  start: string; // HH:MM
  end: string; // HH:MM
  excludeJobId?: string | null;
  excludeLeadId?: string | null;
  /** id "" = record not created yet; call flushOverride(entity) after saving. */
  entity: { type: "job" | "lead"; id: string };
};

type Pending = { args: ConfirmBookingArgs; overlaps: ClashRow[]; tight: ClashRow[]; afterHours: boolean; resolve: (ok: boolean) => void };

/** Office clash warning before saving a booking. Never shows money. */
export function useClashGuard() {
  const { user } = useAuth();
  const { companyId } = useUserCompanyId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const pendingRef = useRef<Pending | null>(null);
  const deferredRef = useRef<{ summary: string; reason: string } | null>(null);

  const writeLog = useCallback(async (entity: { type: string; id: string }, summary: string, why: string) => {
    try {
      await (supabase.from("status_change_log") as any).insert({
        entity_type: entity.type, entity_id: entity.id, field_name: "clash_override",
        old_status: summary.slice(0, 300), new_status: why || "(no reason)",
        changed_by: user?.id ?? null, company_id: companyId ?? null,
      });
    } catch (e) {
      console.warn("[clash] override log failed", e);
    }
  }, [user?.id, companyId]);

  /** Write a deferred override once the new record has an id (best effort). */
  const flushOverride = useCallback(async (entity: { type: "job" | "lead"; id: string }) => {
    const d = deferredRef.current;
    deferredRef.current = null;
    if (d && entity.id) await writeLog(entity, d.summary, d.reason);
  }, [writeLog]);

  const confirmBooking = useCallback(async (args: ConfirmBookingArgs): Promise<boolean> => {
    deferredRef.current = null;
    if (!args.profileId || !args.date || !args.start || !args.end) return true;
    let rows: ClashRow[] = [];
    try {
      const { data, error } = await (supabase.rpc as any)("booking_clashes", {
        p_profile_id: args.profileId, p_date: args.date, p_start: hhmm(args.start), p_end: hhmm(args.end),
        p_exclude_job_id: args.excludeJobId ?? null, p_exclude_lead_id: args.excludeLeadId ?? null,
      });
      if (error) throw error;
      rows = (data || []) as ClashRow[];
    } catch (e) {
      console.warn("[clash] check failed, booking allowed", e);
    }
    const overlaps = rows.filter((r) => r.kind === "overlap");
    const tight = rows.filter((r) => r.kind === "tight");
    const afterHours = isAfterHours(args.date, { start: args.start, end: args.end });
    if (!overlaps.length && !tight.length && !afterHours) return true;
    return new Promise<boolean>((resolve) => {
      const p = { args, overlaps, tight, afterHours, resolve };
      pendingRef.current = p;
      setReason("");
      setPending(p);
    });
  }, []);

  const close = (ok: boolean) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.resolve(ok);
  };

  const bookAnyway = async () => {
    const p = pendingRef.current;
    if (!p) return;
    if (p.overlaps.length && reason.trim().length < 3) return;
    const summary = [clashSummary([...p.overlaps, ...p.tight]), p.afterHours ? "outside working hours" : ""].filter(Boolean).join("; ");
    if (p.args.entity.id) void writeLog(p.args.entity, summary, reason.trim());
    else deferredRef.current = { summary, reason: reason.trim() };
    close(true);
  };

  const needReason = !!pending?.overlaps.length;
  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) close(false); }}>
      <AlertDialogContent data-testid="clash-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{needReason ? "Double booking" : "Check this booking"}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1 text-sm">
              {pending?.overlaps.map((r, i) => (
                <p key={`o${i}`} className="font-medium text-destructive">
                  Already booked {hhmm(r.start_time)}–{hhmm(r.end_time)} · {r.label}. Book anyway?
                </p>
              ))}
              {pending?.tight.map((r, i) => (
                <p key={`t${i}`} className="text-muted-foreground">
                  Tight: under 30 min between jobs ({toMinutes(r.end_time) <= toMinutes(pending.args.start) ? `ends ${hhmm(r.end_time)}` : `starts ${hhmm(r.start_time)}`})
                </p>
              ))}
              {pending?.afterHours && (
                <p className="text-muted-foreground">Outside working hours (Mon–Fri {WORK_START}–{WORK_END})</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {needReason && (
          <div className="space-y-1">
            <Label htmlFor="clash-reason">Reason (required)</Label>
            <Textarea id="clash-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why book over this?" />
          </div>
        )}
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button variant={needReason ? "destructive" : "default"} disabled={needReason && reason.trim().length < 3} onClick={bookAnyway}>
            Book anyway
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmBooking, flushOverride, dialog };
}
