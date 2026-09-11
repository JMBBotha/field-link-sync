import { useEffect, useState } from "react";
import { useRole } from "@/hooks/useRole";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Briefcase, MapPin, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const MAX_AUTO_SHOWS = 3;

const seenKey = (userId: string) => `welcome-tour-seen:${userId}`;
const countKey = (userId: string) => `welcome-tour-auto-count:${userId}`;
const sessionKey = (userId: string) => `welcome-tour-auto-shown:${userId}`;

/**
 * Welcome tour dialog. Auto-shows on at most the first 3 logins per user.
 * "Don't show again" permanently dismisses it (`welcome-tour-seen:<userId>`);
 * "Got it" closes for this session and counts one auto-show. After 3
 * auto-shows without a permanent dismiss, it stops auto-showing entirely.
 */
export function WelcomeTourDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const { isFieldAgent, isAdmin, isDispatcher } = useRole();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const localDismissed = localStorage.getItem(seenKey(userId)) === "1";
      const localCount = Number(localStorage.getItem(countKey(userId)) || "0");
      const { data } = await supabase
        .from("profiles")
        .select("welcome_tour_dismissed, welcome_tour_auto_count")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const dismissed = localDismissed || data?.welcome_tour_dismissed === true;
      const count = Math.max(localCount, Number(data?.welcome_tour_auto_count) || 0);
      localStorage.setItem(countKey(userId), String(count));
      if (dismissed) {
        localStorage.setItem(seenKey(userId), "1");
        if (localDismissed && !data?.welcome_tour_dismissed) {
          await supabase.from("profiles").update({ welcome_tour_dismissed: true }).eq("id", userId);
        }
        return;
      }
      if (count >= MAX_AUTO_SHOWS || sessionStorage.getItem(sessionKey(userId))) return;
      timer = setTimeout(async () => {
        if (cancelled) return;
        const nextCount = Math.min(MAX_AUTO_SHOWS, count + 1);
        localStorage.setItem(countKey(userId), String(nextCount));
        sessionStorage.setItem(sessionKey(userId), "1");
        setOpen(true);
        await supabase.from("profiles").update({ welcome_tour_auto_count: nextCount }).eq("id", userId);
      }, 600);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId]);

  /** Close for this session only — may return on later logins (up to 3 total). */
  const dismissForNow = () => setOpen(false);

  /** Permanently dismiss — never auto-show again. */
  const dismissPermanently = async () => {
    if (userId) localStorage.setItem(seenKey(userId), "1");
    setOpen(false);
    if (userId) {
      const { error } = await supabase.from("profiles").update({ welcome_tour_dismissed: true }).eq("id", userId);
      if (error) console.error("Could not save welcome tour preference", error);
    }
  };

  // Role-tailored quick tips
  const tips = isFieldAgent && !isAdmin && !isDispatcher
    ? [
        { icon: Briefcase, title: "My Jobs", body: "Your assigned jobs live here. Tap a job to see details, update status, and add photos." },
        { icon: MapPin, title: "Map", body: "See job locations and navigate. Works offline — queued actions sync when you're back online." },
        { icon: Sparkles, title: "Offline-ready", body: "Status changes, notes, and photos are saved locally if you lose signal." },
      ]
    : [
        { icon: LayoutDashboard, title: "Dashboard", body: "Live KPIs, today's jobs, and team activity at a glance." },
        { icon: Briefcase, title: "Dispatch Board", body: "Drag jobs across columns to reassign. Use Auto to pick the nearest available tech." },
        { icon: MapPin, title: "Map & Schedule", body: "Real-time technician locations and calendar view for planning routes." },
      ];

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismissForNow())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Welcome aboard
          </DialogTitle>
          <DialogDescription>
            Here's a quick tour of what you'll use most.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3 py-2">
          {tips.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={dismissPermanently} className="w-full sm:w-auto text-muted-foreground">
            Don't show again
          </Button>
          <Button onClick={dismissForNow} className="w-full sm:w-auto">
            Got it — let's go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
