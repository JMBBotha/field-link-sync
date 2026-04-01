import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo.png";
import {
  Building2,
  Settings,
  Users,
  Rocket,
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
  Wrench,
} from "lucide-react";

const SERVICES = [
  "AC Installation",
  "AC Repairs",
  "Maintenance",
  "Ventilation",
  "Refrigeration",
  "Heat Pumps",
  "Geysers",
  "Solar",
];

// ─── Admin step components ───────────────────────────────────────────

interface AdminStepProps {
  form: AdminForm;
  update: (key: keyof AdminForm, value: any) => void;
  updateBanking: (key: string, value: string) => void;
  selectedServices: string[];
  toggleService: (s: string) => void;
}

interface AdminForm {
  company_name: string;
  vat_number: string;
  physical_address: string;
  postal_address: string;
  default_hourly_rate: number;
  default_deposit_percentage: number;
  default_payment_terms_days: number;
  banking_details: {
    bank_name?: string;
    account_number?: string;
    branch_code?: string;
    account_type?: string;
  };
}

const AdminWelcomeStep = () => (
  <div className="flex flex-col items-center gap-5 text-center">
    <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
      <Users className="h-10 w-10 text-primary" />
    </div>
    <div>
      <h2 className="text-2xl font-bold text-foreground">Welcome, Admin!</h2>
      <p className="text-muted-foreground mt-2 text-sm max-w-sm mx-auto">
        Let's set up your company so your team can start managing leads, quotes, and jobs.
      </p>
    </div>
    <Badge variant="outline" className="text-sm px-4 py-1">Role: Administrator</Badge>
  </div>
);

const AdminCompanyStep = ({ form, update }: AdminStepProps) => (
  <div className="space-y-4 w-full">
    <div className="flex items-center gap-2 mb-2">
      <Building2 className="h-5 w-5 text-primary" />
      <h2 className="text-lg font-semibold">Company Details</h2>
    </div>
    <div className="space-y-1.5">
      <Label>Company Name *</Label>
      <Input value={form.company_name} onChange={(e) => update("company_name", e.target.value)} placeholder="0800-BE-COOL AC Super Service" />
    </div>
    <div className="space-y-1.5">
      <Label>VAT Number</Label>
      <Input value={form.vat_number} onChange={(e) => update("vat_number", e.target.value)} placeholder="e.g. 4123456789" />
    </div>
    <div className="space-y-1.5">
      <Label>Physical Address</Label>
      <Input value={form.physical_address} onChange={(e) => update("physical_address", e.target.value)} placeholder="123 Main Rd, Cape Town" />
    </div>
    <div className="space-y-1.5">
      <Label>Postal Address</Label>
      <Input value={form.postal_address} onChange={(e) => update("postal_address", e.target.value)} />
    </div>
  </div>
);

const AdminServicesStep = ({ form, update, selectedServices, toggleService }: AdminStepProps) => (
  <div className="space-y-4 w-full">
    <div className="flex items-center gap-2 mb-2">
      <Wrench className="h-5 w-5 text-primary" />
      <h2 className="text-lg font-semibold">Services & Rates</h2>
    </div>
    <div className="space-y-2">
      <Label>Services Offered</Label>
      <div className="grid grid-cols-2 gap-2">
        {SERVICES.map((s) => (
          <label key={s} className="flex items-center gap-2 cursor-pointer p-2 rounded-md border hover:bg-accent transition-colors text-sm">
            <Checkbox checked={selectedServices.includes(s)} onCheckedChange={() => toggleService(s)} />
            <span>{s}</span>
          </label>
        ))}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>Hourly Rate (ZAR)</Label>
        <Input type="number" value={form.default_hourly_rate} onChange={(e) => update("default_hourly_rate", parseFloat(e.target.value) || 0)} />
      </div>
      <div className="space-y-1.5">
        <Label>Deposit %</Label>
        <Input type="number" value={form.default_deposit_percentage} onChange={(e) => update("default_deposit_percentage", parseFloat(e.target.value) || 0)} />
      </div>
    </div>
    <div className="space-y-1.5">
      <Label>Payment Terms (days)</Label>
      <Input type="number" value={form.default_payment_terms_days} onChange={(e) => update("default_payment_terms_days", parseInt(e.target.value) || 30)} />
    </div>
  </div>
);

const AdminBankingStep = ({ form, updateBanking }: AdminStepProps) => (
  <div className="space-y-4 w-full">
    <div className="flex items-center gap-2 mb-2">
      <Settings className="h-5 w-5 text-primary" />
      <h2 className="text-lg font-semibold">Banking Details</h2>
    </div>
    <p className="text-xs text-muted-foreground -mt-2">Used on invoices and quotes. You can update this later in Settings.</p>
    <div className="space-y-1.5">
      <Label>Bank Name</Label>
      <Input value={form.banking_details.bank_name || ""} onChange={(e) => updateBanking("bank_name", e.target.value)} placeholder="FNB" />
    </div>
    <div className="space-y-1.5">
      <Label>Account Number</Label>
      <Input value={form.banking_details.account_number || ""} onChange={(e) => updateBanking("account_number", e.target.value)} />
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>Branch Code</Label>
        <Input value={form.banking_details.branch_code || ""} onChange={(e) => updateBanking("branch_code", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Account Type</Label>
        <Input value={form.banking_details.account_type || ""} onChange={(e) => updateBanking("account_type", e.target.value)} placeholder="Cheque" />
      </div>
    </div>
  </div>
);

const AdminCompleteStep = () => (
  <div className="flex flex-col items-center gap-5 text-center">
    <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
      <Rocket className="h-10 w-10 text-primary" />
    </div>
    <div>
      <h2 className="text-xl font-bold text-foreground">You're All Set! 🎉</h2>
      <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
        Your company is configured. Here's what to do first:
      </p>
    </div>
    <div className="space-y-2.5 w-full max-w-xs text-left">
      {[
        { icon: Package, label: "Import your product catalog" },
        { icon: Users, label: "Add field agents in Settings" },
        { icon: MapPin, label: "Create your first lead" },
      ].map(({ icon: Icon, label }, i) => (
        <div key={i} className="flex items-center gap-3 bg-muted rounded-lg px-3 py-2.5">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm text-foreground">{label}</span>
        </div>
      ))}
    </div>
  </div>
);

// ─── Field Agent step components ─────────────────────────────────────

interface AgentStepProps {
  homeBase: { lat: number; lng: number } | null;
  gettingLocation: boolean;
  onGetLocation: () => void;
  whatsappEnabled: boolean;
  onWhatsappChange: (v: boolean) => void;
}

const AgentWelcomeStep = () => (
  <div className="flex flex-col items-center gap-5 text-center">
    <div className="h-20 w-20 rounded-full bg-[hsl(45,93%,47%)]/15 flex items-center justify-center">
      <HandMetal className="h-10 w-10 text-[hsl(45,93%,47%)]" />
    </div>
    <div>
      <h2 className="text-2xl font-bold text-foreground">Welcome, Technician!</h2>
      <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
        You'll receive nearby leads, track your jobs, and log work — all from your phone.
      </p>
    </div>
    <Badge className="bg-[hsl(45,93%,47%)]/15 text-[hsl(45,93%,40%)] border-[hsl(45,93%,47%)]/30 text-sm px-4 py-1">
      Role: Field Agent
    </Badge>
  </div>
);

const AgentLocationStep = ({ homeBase, gettingLocation, onGetLocation }: AgentStepProps) => (
  <div className="flex flex-col items-center gap-5 text-center">
    <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
      <MapPin className="h-10 w-10 text-primary" />
    </div>
    <div>
      <h2 className="text-xl font-bold text-foreground">Set Your Home Base</h2>
      <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
        We use this to find leads near you. You can update it anytime.
      </p>
    </div>
    <Button onClick={onGetLocation} disabled={gettingLocation} size="lg" className="w-full max-w-xs">
      {gettingLocation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Compass className="mr-2 h-4 w-4" />}
      {homeBase ? "Update Location" : "Detect My Location"}
    </Button>
    {homeBase && (
      <p className="text-xs text-muted-foreground">📍 {homeBase.lat.toFixed(4)}, {homeBase.lng.toFixed(4)}</p>
    )}
  </div>
);

const AgentNotificationsStep = ({ whatsappEnabled, onWhatsappChange }: AgentStepProps) => (
  <div className="flex flex-col items-center gap-5 text-center">
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
      <Switch checked={whatsappEnabled} onCheckedChange={onWhatsappChange} />
    </div>
  </div>
);

const AgentCompleteStep = () => (
  <div className="flex flex-col items-center gap-5 text-center">
    <div className="h-20 w-20 rounded-full bg-[hsl(45,93%,47%)]/15 flex items-center justify-center">
      <CheckCircle2 className="h-10 w-10 text-[hsl(45,93%,47%)]" />
    </div>
    <div>
      <h2 className="text-xl font-bold text-foreground">Ready to Go!</h2>
      <p className="text-muted-foreground mt-2 text-sm max-w-xs mx-auto">
        Here's what you'll use every day:
      </p>
    </div>
    <div className="space-y-2.5 w-full max-w-xs text-left">
      {[
        { icon: HandMetal, label: "Accept Lead — tap to claim nearby jobs", accent: true },
        { icon: Timer, label: "Start Timer — track time on each job", accent: false },
        { icon: Camera, label: "Add Photos — capture before & after shots", accent: false },
      ].map(({ icon: Icon, label, accent }, i) => (
        <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${accent ? "bg-[hsl(45,93%,47%)]/10" : "bg-muted"}`}>
          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${accent ? "bg-[hsl(45,93%,47%)]/20" : "bg-primary/10"}`}>
            <Icon className={`h-4 w-4 ${accent ? "text-[hsl(45,93%,47%)]" : "text-primary"}`} />
          </div>
          <span className="text-sm text-foreground">{label}</span>
        </div>
      ))}
    </div>
  </div>
);

// ─── Main component ──────────────────────────────────────────────────

const UnifiedOnboarding = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"admin" | "field_agent" | null>(null);
  const [step, setStep] = useState(0);

  // Admin form state
  const [adminForm, setAdminForm] = useState<AdminForm>({
    company_name: "0800-BE-COOL AC Super Service",
    vat_number: "",
    physical_address: "",
    postal_address: "",
    default_hourly_rate: 450,
    default_deposit_percentage: 50,
    default_payment_terms_days: 30,
    banking_details: { bank_name: "FNB", account_number: "", branch_code: "", account_type: "Cheque" },
  });
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  // Agent form state
  const [homeBase, setHomeBase] = useState<{ lat: number; lng: number } | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);

  const updateAdmin = (key: keyof AdminForm, value: any) => setAdminForm((p) => ({ ...p, [key]: value }));
  const updateBanking = (key: string, value: string) =>
    setAdminForm((p) => ({ ...p, banking_details: { ...p.banking_details, [key]: value } }));
  const toggleService = (s: string) =>
    setSelectedServices((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  // Check auth & role on mount
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login"); return; }

      const uid = session.user.id;
      setUserId(uid);

      // Check if already completed
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", uid)
        .maybeSingle();

      if (profile?.onboarding_completed) {
        // Already onboarded — redirect by role
        const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
        const hasAdmin = roles?.some((r) => ["admin", "dispatcher", "viewer"].includes(r.role));
        navigate(hasAdmin ? "/admin" : "/field");
        return;
      }

      // Determine role
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      if (roles && roles.length > 0) {
        const hasAdmin = roles.some((r) => ["admin", "dispatcher", "viewer"].includes(r.role));
        setUserRole(hasAdmin ? "admin" : "field_agent");
      } else {
        // First user = admin (auto-assign)
        await supabase.from("user_roles").insert({ user_id: uid, role: "admin" });
        setUserRole("admin");
      }

      setLoading(false);
    };
    init();
  }, [navigate]);

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
        if (userId) {
          await supabase.from("profiles").update({ home_base_lat: lat, home_base_lng: lng }).eq("id", userId);
        }
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

  // ── Build steps based on role ──

  const adminStepLabels = ["Welcome", "Company", "Services & Rates", "Banking", "Done"];
  const agentStepLabels = ["Welcome", "Location", "Notifications", "Ready"];

  const stepLabels = userRole === "admin" ? adminStepLabels : agentStepLabels;
  const totalSteps = stepLabels.length;
  const progress = ((step + 1) / totalSteps) * 100;

  const sharedAgentProps: AgentStepProps = {
    homeBase,
    gettingLocation,
    onGetLocation: handleGetLocation,
    whatsappEnabled,
    onWhatsappChange: setWhatsappEnabled,
  };

  const sharedAdminProps: AdminStepProps = {
    form: adminForm,
    update: updateAdmin,
    updateBanking,
    selectedServices,
    toggleService,
  };

  const adminSteps = [
    <AdminWelcomeStep key="w" />,
    <AdminCompanyStep key="c" {...sharedAdminProps} />,
    <AdminServicesStep key="s" {...sharedAdminProps} />,
    <AdminBankingStep key="b" {...sharedAdminProps} />,
    <AdminCompleteStep key="d" />,
  ];

  const agentSteps = [
    <AgentWelcomeStep key="w" />,
    <AgentLocationStep key="l" {...sharedAgentProps} />,
    <AgentNotificationsStep key="n" {...sharedAgentProps} />,
    <AgentCompleteStep key="d" />,
  ];

  const steps = userRole === "admin" ? adminSteps : agentSteps;

  const handleComplete = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      if (userRole === "admin") {
        // Save company settings (upsert)
        const { data: existing } = await supabase.from("company_settings").select("id").limit(1).maybeSingle();
        if (existing) {
          await supabase.from("company_settings").update({
            company_name: adminForm.company_name,
            vat_number: adminForm.vat_number,
            physical_address: adminForm.physical_address,
            postal_address: adminForm.postal_address,
            default_hourly_rate: adminForm.default_hourly_rate,
            default_deposit_percentage: adminForm.default_deposit_percentage,
            default_payment_terms_days: adminForm.default_payment_terms_days,
            banking_details: adminForm.banking_details as any,
            updated_at: new Date().toISOString(),
          }).eq("id", existing.id);
        } else {
          await supabase.from("company_settings").insert({
            company_name: adminForm.company_name,
            vat_number: adminForm.vat_number,
            physical_address: adminForm.physical_address,
            postal_address: adminForm.postal_address,
            default_hourly_rate: adminForm.default_hourly_rate,
            default_deposit_percentage: adminForm.default_deposit_percentage,
            default_payment_terms_days: adminForm.default_payment_terms_days,
            banking_details: adminForm.banking_details as any,
          });
        }
      }

      // Save WhatsApp preference & mark complete
      await supabase.from("profiles").update({
        onboarding_completed: true,
        whatsapp_notifications: whatsappEnabled,
      } as any).eq("id", userId);

      toast({ title: "Setup complete! 🎉" });
      navigate(userRole === "admin" ? "/admin" : "/field");
    } catch (err: any) {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const next = () => setStep((s) => Math.min(s + 1, totalSteps - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const canAdvance = () => {
    if (userRole === "admin" && step === 1 && !adminForm.company_name.trim()) return false;
    return true;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)]">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)] p-4">
      {/* Header */}
      <div className="mb-6">
        <img src={logo} alt="0800BeCool" className="h-[84px] w-auto drop-shadow-lg" />
      </div>

      <div className="w-full max-w-lg space-y-6">
        {/* Progress */}
        <div className="space-y-2">
          <Progress value={progress} className="h-1.5 [&>div]:bg-[hsl(25,95%,53%)]" />
          <div className="flex justify-between">
            {stepLabels.map((label, i) => (
              <span key={i} className={`text-[10px] ${i <= step ? "text-white font-medium" : "text-white/50"}`}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-[360px] flex items-start justify-center rounded-xl bg-white/10 backdrop-blur-md border border-white/15 px-6 py-6">
          <div className="w-full [&_h2]:text-white [&_p]:text-white/70 [&_label]:text-white/90 [&_span]:text-white/80 [&_.text-foreground]:text-white [&_.text-muted-foreground]:text-white/60 [&_.bg-muted]:bg-white/10 [&_.border]:border-white/20 [&_input]:bg-white/10 [&_input]:border-white/20 [&_input]:text-white [&_input]:placeholder:text-white/40">
            {steps[step]}
          </div>
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" size="sm" onClick={prev} className="text-white/80 hover:text-white hover:bg-white/10">
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          ) : (
            <div />
          )}

          {step < totalSteps - 1 ? (
            <Button size="sm" onClick={next} disabled={!canAdvance()} className="bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,45%)] text-white">
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleComplete} disabled={saving} className="bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,45%)] text-white">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {userRole === "admin" ? "Launch Dashboard" : "Start Working"} <Rocket className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>

        {/* Sign out / back to login */}
        <div className="text-center">
          <Button
            variant="link"
            size="sm"
            className="text-white/50 hover:text-white/80 text-xs"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/login");
            }}
          >
            Sign out & return to login
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UnifiedOnboarding;
