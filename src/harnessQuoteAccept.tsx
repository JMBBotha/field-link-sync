/**
 * Screenshot harness for the quote page, before and after an invoice is created.
 * Sample figures only. Nothing is saved and no client record is read.
 * Open with ?phase=before or ?phase=after.
 */
import "./index.css";
import "./components/v8/v8.css";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { FileText, Home, Receipt, Wrench } from "lucide-react";
import StatusPill from "@/components/shared/StatusPill";
import QuoteAcceptedLock from "@/components/quoting/QuoteAcceptedLock";
import type { QuoteLockState } from "@/hooks/useQuoteLock";

const phase = new URLSearchParams(window.location.search).get("phase") === "after" ? "after" : "before";
const accepted = phase === "after";

const lock: QuoteLockState = {
  state: "accepted_locked",
  status: "accepted",
  locked_at: "2026-11-23T11:05:00.000Z",
  locked_reason: "accepted",
  invoice_number: null,
  invoice_status: null,
  is_admin: true,
  can_edit: false,
  can_unlock: true,
  can_relock: false,
  can_variation: true,
  can_correct_client: true,
  last_unlock: null,
  variations: [],
  parent: null,
  is_variation: false,
  variation_kind: null,
};

const lines = [
  { name: "Samsung AR12 · Lounge", detail: "12 000 BTU wall split", amount: "R 12 400,00" },
  { name: "Standard installation", detail: "Piping, trunking and commissioning", amount: "R 6 000,00" },
];

function Side() {
  const items = [
    { label: "Home", icon: Home, on: false },
    { label: "Quotes", icon: FileText, on: true },
    { label: "Invoices", icon: Receipt, on: false },
    { label: "Jobs", icon: Wrench, on: false },
  ];
  return (
    <aside className="v8-richer-halo hidden h-full w-[232px] shrink-0 lg:block" data-testid="v8-sidebar-halo" aria-label="Side menu">
      <div className="v8-side flex h-full flex-col">
        <div className="px-3 pt-3">
          <div className="v8-halo-mark">
            <div className="v8-mark">Field Lynk</div>
            <div className="v8-mark-sync">SYNC</div>
          </div>
          <div className="mt-2 truncate text-sm font-bold">Massair CT</div>
        </div>
        <nav className="mt-3 flex-1 px-2" aria-label="Main">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className={item.on ? "v8-nav is-active" : "v8-nav"} aria-current={item.on ? "page" : undefined}>
                <Icon className="h-4 w-4" />
                {item.label}
              </div>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

function QuotePage() {
  return (
    <div className="v8-scope flex h-[100dvh] flex-col bg-background" data-testid="quote-accept-harness" data-phase={phase}>
      <header className="v8-bar-hdr flex h-14 shrink-0 items-center gap-2 border-b px-3" style={{ background: "#3D9BEB", color: "#fff" }}>
        <div className="min-w-0">
          <div className="truncate text-base font-bold">Estimate Q-2026-0142</div>
          <div className="truncate text-xs text-white/80">Harbour View</div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Side />
        <main className="min-w-0 flex-1 overflow-auto px-3 pb-24 pt-3 lg:px-6 lg:pb-8">
          <p className="mb-3 rounded-lg bg-[#0F1B2A] px-3 py-2 text-xs font-semibold text-white">
            Sample quote. Nothing is saved.
          </p>
          <div className="mx-auto max-w-4xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="min-w-0 truncate text-base font-bold">
                <span className="hidden sm:inline">Estimate </span>Q-2026-0142
              </h1>
              <StatusPill status={accepted ? "accepted" : "sent"} />
            </div>

            {accepted ? (
              <QuoteAcceptedLock quoteId="q-harness" lock={lock} onChanged={() => undefined} />
            ) : null}

            <section className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-sm text-muted-foreground">Client</div>
              <div className="text-lg font-semibold">Harbour View</div>
              <div className="text-sm text-muted-foreground">12 Harbour Road, Stellenbosch</div>
              <div className="mt-4 divide-y border-t">
                {lines.map((line) => (
                  <div key={line.name} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="font-medium">{line.name}</div>
                      <div className="text-sm text-muted-foreground">{line.detail}</div>
                    </div>
                    <div className="shrink-0 font-semibold">{line.amount}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">Total incl VAT</span>
                <span className="text-lg font-bold">R 18 400,00</span>
              </div>
            </section>

            <section className="rounded-xl border bg-card px-4 py-3 text-sm shadow-sm" data-testid="quote-invoice-state">
              {accepted ? (
                <p><span className="font-semibold">Invoice INV-1042</span> · draft · 23 Nov 2026. The quote is accepted and locked.</p>
              ) : (
                <p>No invoice yet. This quote is still sent, and it is not locked.</p>
              )}
            </section>
          </div>
        </main>
      </div>
      <nav className="v8-tabs fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t lg:hidden" data-testid="v8-bottom-nav" aria-label="Phone tabs">
        <div className="v8-tab"><Home className="h-5 w-5" /><span>Home</span></div>
        <div className="v8-tab is-active"><FileText className="h-5 w-5" /><span>Quotes</span></div>
        <div className="v8-tab"><Receipt className="h-5 w-5" /><span>Invoices</span></div>
        <div className="v8-tab"><Wrench className="h-5 w-5" /><span>Jobs</span></div>
      </nav>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <QuotePage />
  </MemoryRouter>,
);
