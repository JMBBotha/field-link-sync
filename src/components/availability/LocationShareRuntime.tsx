import { useEffect, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  desiredIdleStatus,
  mayShareLocation,
  type AvailabilitySchedule,
  type IdleStatus,
  type ShareSnapshot,
} from "@/lib/availabilitySchedule";
import { syncBackgroundShare } from "@/lib/backgroundShare";
import { getLocationShareSnapshot, setLocationShareSnapshot, shareLocationIfAllowed } from "@/lib/locationPing";
import {
  LOCATION_PING_INTERVAL_MS,
  refreshBackgroundLocationHeaders,
  startBackgroundLocation,
  stopBackgroundLocation,
} from "@/lib/nativeBackgroundLocation";

type PlanSchedule = {
  timezone?: string;
  days?: number[];
  start?: string;
  end?: string;
  enabled?: boolean;
  override_status?: string | null;
  override_until?: string | null;
};

type Plan = {
  saved?: boolean;
  status?: string;
  tracking_enabled?: boolean;
  schedule?: PlanSchedule | null;
};

function asSchedule(row: PlanSchedule | null | undefined): AvailabilitySchedule | null {
  if (!row?.timezone || !row.start || !row.end || !row.days) return null;
  const override = row.override_status === "available" || row.override_status === "offline"
    ? row.override_status as IdleStatus
    : null;
  return {
    enabled: row.enabled !== false,
    days: row.days.map(Number),
    start: row.start.slice(0, 5),
    end: row.end.slice(0, 5),
    timezone: row.timezone,
    overrideStatus: override,
    overrideUntil: row.override_until ? new Date(row.override_until) : null,
  };
}

async function readPlan(apply: boolean): Promise<Plan | null> {
  const { data, error } = await (supabase.rpc as any)(apply ? "apply_my_availability_schedule" : "ensure_my_availability_schedule");
  if (error) {
    console.error("[location] schedule", error.message);
    return null;
  }
  if (apply) {
    const { data: plan, error: planError } = await (supabase.rpc as any)("my_availability_plan");
    if (planError) return { status: typeof data === "string" ? data : undefined };
    return plan as Plan;
  }
  return (data || null) as Plan;
}

/**
 * Keeps the weekly window and the Android foreground service in step.
 * Sharing starts only when the person is signed in, opted in, and Available.
 * Go offline, sign-out, opt-out, or leaving the window stops it immediately.
 */
export default function LocationShareRuntime() {
  const { session } = useAuth();
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  const lastPing = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const publish = (plan: Plan | null, signedIn: boolean): ShareSnapshot => {
      const schedule = asSchedule(plan?.schedule);
      const status = plan?.status || "offline";
      const snap: ShareSnapshot = {
        signedIn,
        trackingEnabled: plan?.tracking_enabled === true,
        status,
        schedule,
      };
      if (schedule && status !== "busy") {
        const desired = desiredIdleStatus(schedule, new Date());
        if (desired && desired !== status) snap.status = desired;
      }
      setLocationShareSnapshot(snap);
      return snap;
    };

    const sync = async (plan: Plan | null) => {
      const snap = publish(plan, !!sessionRef.current);
      if (cancelled) return;
      await syncBackgroundShare(snap, new Date(), {
        start: () => startBackgroundLocation((fix) => {
          const at = new Date();
          const live = getLocationShareSnapshot();
          if (!mayShareLocation(live, at)) {
            void stopBackgroundLocation();
            void (supabase.rpc as any)("apply_my_availability_schedule");
            return;
          }
          if (Date.now() - lastPing.current < LOCATION_PING_INTERVAL_MS) return;
          lastPing.current = Date.now();
          void shareLocationIfAllowed(fix.latitude, fix.longitude, at);
        }),
        stop: () => stopBackgroundLocation(),
      });
    };

    const refresh = async (apply: boolean) => {
      try {
        if (!sessionRef.current) {
          publish(null, false);
          await stopBackgroundLocation();
          return;
        }
        const plan = await readPlan(apply);
        if (cancelled) return;
        await sync(plan);
      } catch (err) {
        console.error("[location] sync failed", err);
      }
    };

    const onAvailability = () => { void refresh(true); };
    const onShare = (event: Event) => {
      const on = (event as CustomEvent<boolean>).detail === true;
      if (!on) void stopBackgroundLocation();
      void refresh(false);
    };
    window.addEventListener("fl:availability-changed", onAvailability);
    window.addEventListener("fl:location-share-changed", onShare);
    document.addEventListener("visibilitychange", onAvailability);

    if (sessionRef.current) {
      void refresh(false).then(() => { if (!cancelled) void refresh(true); });
      timer = window.setInterval(() => { void refresh(true); }, 30_000);
    } else {
      void stopBackgroundLocation();
    }

    let removeApp: { remove: () => void } | null = null;
    void import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", () => { void refresh(true); }))
      .then((handle) => { removeApp = handle; })
      .catch(() => {});

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("fl:availability-changed", onAvailability);
      window.removeEventListener("fl:location-share-changed", onShare);
      document.removeEventListener("visibilitychange", onAvailability);
      void removeApp?.remove();
      void stopBackgroundLocation();
    };
  }, [session?.user?.id]);

  const accessToken = session?.access_token ?? null;
  const seenToken = useRef(accessToken);
  useEffect(() => {
    const previous = seenToken.current;
    seenToken.current = accessToken;
    if (previous && accessToken && previous !== accessToken) void refreshBackgroundLocationHeaders();
  }, [accessToken]);

  return null;
}
