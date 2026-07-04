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

/**
 * One-time welcome dialog shown on first login per user.
 * Reversible: clear `welcome-tour-seen:<userId>` in localStorage to re-trigger.
 */
export function WelcomeTourDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const { isFieldAgent, isAdmin, isDispatcher } = useRole();

  useEffect(() => {
    if (!userId) return;
    const key = `welcome-tour-seen:${userId}`;
    if (!localStorage.getItem(key)) {
      // Small delay so it doesn't fight the initial page render
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [userId]);

  const dismiss = () => {
    if (userId) localStorage.setItem(`welcome-tour-seen:${userId}`, "1");
    setOpen(false);
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
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
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

        <DialogFooter>
          <Button onClick={dismiss} className="w-full sm:w-auto">
            Got it — let's go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
