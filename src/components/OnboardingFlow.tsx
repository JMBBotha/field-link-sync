import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin,
  Bell,
  Compass,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Camera,
  Timer,
  HandMetal,
  Package,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface OnboardingFlowProps {
  userId: string;
  userRole: "admin" | "field_agent";
  onComplete: () => void;
}

const OnboardingFlow = ({ userId, userRole, onComplete }: OnboardingFlowProps) => {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [homeBase, setHomeBase] = useState<{ lat: number; lng: number } | null>(null);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const { toast } = useToast();

  const totalSteps = 4;

  const handleGetLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation not supported", variant: "destructive" });
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setHomeBase({ lat, lng });

        await supabase
          .from("profiles")
          .update({ home_base_lat: lat, home_base_lng: lng })
          .eq("id", userId);

        setGettingLocation(false);
        toast({ title: "Location saved!", description: `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
      },
      (err) => {
        setGettingLocation(false);
        toast({ title: "Location error", description: err.message, variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, [userId, toast]);

  const handleComplete = async () => {
    setSaving(true);
    try {
      await supabase
        .from("profiles")
        .update({ onboarding_completed: true })
        .eq("id", userId);
      onComplete();
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("id", userId);
    setSaving(false);
    onComplete();
  };

  const next = () => setStep((s) => Math.min(s + 1, totalSteps - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  // Touch swipe handling
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => setTouchStart(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 60) {
      if (diff > 0) next();
      else prev();
    }
    setTouchStart(null);
  };

  const adminSteps = [
    // Step 1: Welcome
    <div key="welcome" className="flex flex-col items-center gap-6 text-center">
      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <Users className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-foreground">Welcome, Admin!</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
          You have full control over your field operations — leads, agents, invoices, and more.
        </p>
      </div>
      <Badge variant="outline" className="text-sm px-4 py-1">
        Role: Administrator
      </Badge>
    </div>,

    // Step 2: Home base
    <div key="location" className="flex flex-col items-center gap-6 text-center">
      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <MapPin className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">Set Your Base Location</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
          Used for lead distance calculations and smart agent assignment.
        </p>
      </div>
      <Button onClick={handleGetLocation} disabled={gettingLocation} size="lg" className="w-full max-w-xs">
        {gettingLocation ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Compass className="mr-2 h-4 w-4" />
        )}
        {homeBase ? "Update Location" : "Detect My Location"}
      </Button>
      {homeBase && (
        <p className="text-xs text-muted-foreground">
          📍 {homeBase.lat.toFixed(4)}, {homeBase.lng.toFixed(4)}
        </p>
      )}
    </div>,

    // Step 3: Notifications
    <div key="notifications" className="flex flex-col items-center gap-6 text-center">
      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <Bell className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">Stay Informed</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
          Get notified about new leads, job updates, and agent activity.
        </p>
      </div>
      <div className="flex items-center gap-3 bg-muted rounded-lg px-4 py-3 w-full max-w-xs">
        <Bell className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm text-foreground flex-1 text-left">WhatsApp Alerts</span>
        <Switch checked={whatsappEnabled} onCheckedChange={setWhatsappEnabled} />
      </div>
    </div>,

    // Step 4: Admin quick tour
    <div key="tour" className="flex flex-col items-center gap-6 text-center">
      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <CheckCircle2 className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">You're All Set!</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
          Here's what to do first as an admin:
        </p>
      </div>
      <div className="space-y-3 w-full max-w-xs text-left">
        {[
          { icon: Package, label: "Import your product catalog (CSV)" },
          { icon: Users, label: "Add field agents in Settings" },
          { icon: MapPin, label: "Create your first lead" },
        ].map(({ icon: Icon, label }, i) => (
          <div key={i} className="flex items-center gap-3 bg-muted rounded-lg px-4 py-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm text-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>,
  ];

  const agentSteps = [
    // Step 1: Welcome
    <div key="welcome" className="flex flex-col items-center gap-6 text-center">
      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <HandMetal className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-foreground">Welcome, Technician!</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
          You'll receive nearby leads, track your jobs, and log work — all from your phone.
        </p>
      </div>
      <Badge variant="outline" className="text-sm px-4 py-1">
        Role: Field Agent
      </Badge>
    </div>,

    // Step 2: Home base
    <div key="location" className="flex flex-col items-center gap-6 text-center">
      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <MapPin className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">Set Your Home Base</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
          We use this to find leads near you. You can update it anytime.
        </p>
      </div>
      <Button onClick={handleGetLocation} disabled={gettingLocation} size="lg" className="w-full max-w-xs">
        {gettingLocation ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Compass className="mr-2 h-4 w-4" />
        )}
        {homeBase ? "Update Location" : "Detect My Location"}
      </Button>
      {homeBase && (
        <p className="text-xs text-muted-foreground">
          📍 {homeBase.lat.toFixed(4)}, {homeBase.lng.toFixed(4)}
        </p>
      )}
    </div>,

    // Step 3: Notifications
    <div key="notifications" className="flex flex-col items-center gap-6 text-center">
      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <Bell className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">Enable Notifications</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
          Get instant alerts when new leads are available near you.
        </p>
      </div>
      <div className="flex items-center gap-3 bg-muted rounded-lg px-4 py-3 w-full max-w-xs">
        <Bell className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm text-foreground flex-1 text-left">WhatsApp Alerts</span>
        <Switch checked={whatsappEnabled} onCheckedChange={setWhatsappEnabled} />
      </div>
    </div>,

    // Step 4: Quick tour
    <div key="tour" className="flex flex-col items-center gap-6 text-center">
      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <CheckCircle2 className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">Quick Tour</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
          Key actions you'll use every day:
        </p>
      </div>
      <div className="space-y-3 w-full max-w-xs text-left">
        {[
          { icon: HandMetal, label: "Accept Lead — tap to claim nearby jobs" },
          { icon: Timer, label: "Start Timer — track time on each job" },
          { icon: Camera, label: "Add Photos — capture before & after shots" },
        ].map(({ icon: Icon, label }, i) => (
          <div key={i} className="flex items-center gap-3 bg-muted rounded-lg px-4 py-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm text-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>,
  ];

  const steps = userRole === "admin" ? adminSteps : agentSteps;

  return (
    <Dialog open modal>
      <DialogContent
        className="max-w-md w-[95vw] p-0 gap-0 overflow-hidden border-border [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-6 pb-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-2 rounded-full transition-all duration-300",
                i === step ? "w-8 bg-primary" : "w-2 bg-muted-foreground/30"
              )}
            />
          ))}
        </div>

        {/* Step content */}
        <div
          className="px-6 py-6 min-h-[380px] flex items-center justify-center"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {steps[step]}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 pb-6 pt-2">
          {step > 0 ? (
            <Button variant="ghost" size="sm" onClick={prev}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={handleSkip} disabled={saving}>
              Skip
            </Button>
          )}

          {step < totalSteps - 1 ? (
            <Button size="sm" onClick={next}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleComplete} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Get Started
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingFlow;
