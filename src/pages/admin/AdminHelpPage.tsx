import { Link } from "react-router-dom";
import {
  UserPlus, Users, FileText, Briefcase, Receipt, CreditCard,
  ArrowRight, HelpCircle, Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRole } from "@/hooks/useRole";

/* ─── Flow diagram (SVG-based, mobile-friendly, no external deps) ─── */
const FlowStep = ({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  sub: string;
}) => (
  <div className="flex flex-col items-center text-center gap-1 min-w-[92px]">
    <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
      <Icon className="h-5 w-5 text-primary" />
    </div>
    <p className="text-xs font-semibold text-foreground">{label}</p>
    <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>
  </div>
);

const FlowArrow = () => (
  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
);

const FlowDiagram = () => (
  <Card>
    <CardHeader className="pb-3">
      <CardTitle className="text-base flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        The core business flow
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
        <FlowStep icon={UserPlus} label="Lead" sub="Enquiry captured" />
        <FlowArrow />
        <FlowStep icon={Users} label="Customer" sub="Deduped + linked" />
        <FlowArrow />
        <FlowStep icon={FileText} label="Quote" sub="One per location" />
        <FlowArrow />
        <FlowStep icon={Briefcase} label="Job" sub="Dispatched" />
        <FlowArrow />
        <FlowStep icon={Receipt} label="Invoice" sub="From accepted quote" />
        <FlowArrow />
        <FlowStep icon={CreditCard} label="Payment" sub="Auto-updates status" />
      </div>
      <p className="text-[11px] text-muted-foreground mt-3">
        Each step carries the same customer and location context forward — no re-typing, no duplicates.
      </p>
    </CardContent>
  </Card>
);

/* ─── How Do I cards ─── */
interface HowCard {
  title: string;
  steps: string[];
  cta?: { label: string; to: string };
  audience: "admin" | "field" | "all";
}

const ADMIN_CARDS: HowCard[] = [
  {
    title: "Create a new Lead",
    audience: "all",
    steps: [
      "Open Dispatch (or the map) and tap the + New Lead button.",
      "Enter the customer's phone. If we already have that number, you'll be prompted to link the existing customer instead of creating a duplicate.",
      "Save. The lead auto-links to a customer and appears on the dispatch board.",
    ],
    cta: { label: "Go to Dispatch", to: "/admin/jobs/dispatch" },
  },
  {
    title: "Turn a Lead into a Quote",
    audience: "admin",
    steps: [
      "Open the lead from Dispatch or the map.",
      "Tap Create Draft Quote — the customer is auto-linked (with a duplicate prompt if needed).",
      "The Quote Builder opens with the lead + customer already filled in. Save when ready.",
    ],
    cta: { label: "Open Quotes", to: "/admin/quotes" },
  },
  {
    title: "Convert a Quote to an Invoice",
    audience: "admin",
    steps: [
      "In Quotes, filter by Accepted.",
      "Tap the green Convert to Invoice icon on the row.",
      "A draft invoice is created (line items, customer, location, and quote link all copied). If a Job exists for the lead, it's auto-linked to the new invoice.",
    ],
    cta: { label: "Open Quotes", to: "/admin/quotes" },
  },
  {
    title: "Record a Payment",
    audience: "admin",
    steps: [
      "Open the invoice from Invoices.",
      "Scroll to Payments and record the amount + method.",
      "Status updates automatically: partial payment → Partially Paid, full → Paid. No manual toggling needed.",
    ],
    cta: { label: "Open Invoices", to: "/admin/invoices" },
  },
  {
    title: "Work offline in the field",
    audience: "field",
    steps: [
      "If you lose signal, a Working Offline banner appears.",
      "Status changes, notes, and photo uploads keep working — they queue locally.",
      "As soon as you're back online the queue drains automatically. Sync conflicts (rare) prompt you to choose.",
    ],
    cta: { label: "My Jobs", to: "/admin/my-jobs" },
  },
  {
    title: "Avoid duplicate customers",
    audience: "admin",
    steps: [
      "Phone and email are normalised — spaces, +27 vs 0, capitals all match.",
      "The Lead dialog and Create Draft Quote both prompt when a possible match is found.",
      "Prefer Link to keep the customer's history in one place.",
    ],
    cta: { label: "Open Customers", to: "/admin/customers" },
  },
];

const HowCards = ({ audience }: { audience: "admin" | "field" }) => {
  const cards = ADMIN_CARDS.filter((c) => c.audience === "all" || c.audience === audience);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {cards.map((c) => (
        <Card key={c.title} className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              {c.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-between gap-3">
            <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground leading-relaxed">
              {c.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {c.cta && (
              <Link
                to={c.cta.to}
                className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                {c.cta.label} <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

/* ─── Page ─── */
const AdminHelpPage = () => {
  const { isAdmin, isDispatcher, isFieldAgent } = useRole();
  const audience: "admin" | "field" = isFieldAgent && !isAdmin && !isDispatcher ? "field" : "admin";

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">How the system works</h1>
          <Badge variant="secondary" className="text-[10px]">
            {audience === "field" ? "Field guide" : "Admin guide"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          A quick tour of the Lead → Payment pipeline and the shortcuts that keep everything connected.
        </p>
      </header>

      <FlowDiagram />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          How do I…
        </h2>
        <HowCards audience={audience} />
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Good to know</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p>• <strong>One customer, one profile.</strong> Duplicate detection runs on every Lead and Draft Quote.</p>
          <p>• <strong>Quotes are per-location.</strong> A customer with multiple sites gets a quote per site.</p>
          <p>• <strong>Invoice status is automatic.</strong> Once payments are recorded, Draft → Sent → Partially Paid → Paid follows the numbers.</p>
          <p>• <strong>Legacy invoices</strong> are the canonical stack. The FreshBooks-style tables are used for the client portal only.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminHelpPage;
