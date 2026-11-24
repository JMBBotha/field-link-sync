/**
 * Signed-out preview of Mandy navigating. Fixture records only — nothing is saved
 * and no audio or client details are sent anywhere. The signed-in dock uses the
 * same navigate_to path, with the real microphone.
 */
import { useState } from "react";
import { MandyDockView } from "@/components/mandy/MandyDockView";
import type { MandyChoice } from "@/lib/mandy/actions";
import type { MandyPhase } from "@/lib/mandy/realtimeTurn";
import { APP_ROUTES } from "@/lib/mandy/appRoutes";
import { runNavigateTo, type NavActor, type NavHit, type NavSearch } from "@/lib/mandy/navigateTo";

const ACTOR: NavActor = { ready: true, roles: ["admin"], salesRep: false, platformOwner: true, companyOwner: true };
const Q63 = "11111111-1111-4111-8111-111111111111";
const Q12 = "22222222-2222-4222-8222-222222222222";
const INV = "33333333-3333-4333-8333-333333333333";

const HITS: NavHit[] = [
  { id: Q63, entity: "quote", reference: "Q-2026-0063", chip: "Q-2026-0063 · Hennie" },
  { id: Q12, entity: "quote", reference: "Q-2026-0012", chip: "Q-2026-0012 · Hennie" },
  { id: INV, entity: "invoice", reference: "INV-045", chip: "INV-045 · Hennie" },
];

const search: NavSearch = {
  search: async (entity, query) => HITS.filter((h) => {
    if (h.entity !== entity) return false;
    const blob = `${h.reference || ""} ${h.chip}`.toLowerCase();
    return blob.includes(query.toLowerCase());
  }),
};

function pageCopy(route: string, doc: string | null): { title: string; line: string } {
  const path = route.split("?")[0];
  if (path === "/admin/invoices" || path.startsWith("/admin/invoices/")) return { title: "Invoices", line: "Invoices for this company. INV-045 is on the list." };
  if (path.startsWith("/admin/estimates/")) return { title: doc ? `Quote ${doc}` : "Quote", line: doc ? `Quote ${doc} is open.` : "Quote is open." };
  if (path === "/admin/quotes") return { title: "Quotes", line: "Quotes for this company." };
  if (path.startsWith("/admin/jobs")) return { title: "Jobs", line: "Jobs, dispatch and the calendar live here." };
  if (path === "/admin/customers" || path.startsWith("/admin/customers/")) return { title: "Clients", line: "Clients for this company." };
  if (path === "/admin/yard") return { title: "Yard", line: "Yard view." };
  if (path === "/admin") return { title: "Dashboard", line: "Home. Cash, work in motion, and jobs on the go." };
  return { title: "Field Lynk", line: route };
}

export default function MandyNavHarness() {
  const [open, setOpen] = useState(true);
  const [route, setRoute] = useState("/admin");
  const [phase, setPhase] = useState<MandyPhase>("idle");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [typed, setTyped] = useState("");
  const [muted, setMuted] = useState(false);
  const [choices, setChoices] = useState<MandyChoice[]>([]);
  const [doc, setDoc] = useState<string | null>(null);

  const run = async (args: Record<string, unknown>, said: string) => {
    setPhase("working");
    setHeard(said);
    setChoices([]);
    const result = await runNavigateTo(args, { actor: ACTOR, routes: APP_ROUTES, search, go: setRoute });
    setChoices(result.choices || []);
    const data = result.data as { route?: unknown; reference?: unknown } | undefined;
    if (typeof data?.route === "string") setDoc(typeof data.reference === "string" ? data.reference : null);
    setReply(result.message);
    setPhase("speaking");
  };

  const send = () => {
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    void run({ utterance: text }, text);
  };

  const copy = pageCopy(route, doc);

  return (
    <div data-testid="mandy-nav-harness" data-route={route} style={{ minHeight: "100vh", background: "#F3F6FA" }}>
      <header style={{ background: "#3D9BEB", color: "#fff", minHeight: 56, display: "flex", alignItems: "center", padding: "0 16px", fontWeight: 700 }}>
        Field Lynk
      </header>
      <main style={{ padding: 16, maxWidth: 880 }}>
        <article style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)" }}>
          <h1 data-testid="nav-page-title" style={{ margin: 0, fontSize: 28, color: "#0f172a" }}>{copy.title}</h1>
          <p style={{ margin: "8px 0 0", color: "#334155" }}>{copy.line}</p>
          {route.startsWith("/admin/estimates/") && doc && (
            <p style={{ marginTop: 16, fontSize: 18, color: "#0f172a" }}>{doc}</p>
          )}
          {(route === "/admin/invoices" || route.startsWith("/admin/invoices/")) && (
            <p style={{ marginTop: 16, fontSize: 18, color: "#0f172a" }}>INV-045</p>
          )}
        </article>
      </main>
      {!open && (
        <button
          type="button"
          data-testid="ask-mandy"
          onClick={() => { setOpen(true); setPhase("idle"); }}
          style={{ position: "fixed", bottom: 16, right: 16, background: "#C2410C", color: "#fff", border: 0, borderRadius: 999, minHeight: 44, padding: "0 16px", fontWeight: 700 }}
        >
          Ask Mandy
        </button>
      )}
      {open && (
        <MandyDockView
          botName="Mandy"
          mode="default"
          phase={phase}
          level={phase === "listening" ? 0.6 : 0}
          heard={heard}
          reply={reply}
          choices={choices}
          confirm={null}
          typed={typed}
          muted={muted}
          live
          step={phase === "working" ? "Opening that…" : null}
          onTyped={setTyped}
          onClose={() => setOpen(false)}
          onToggleMute={() => setMuted((m) => !m)}
          onMic={() => {
            if (phase === "listening") {
              if (typed.trim()) send();
              else {
                setPhase("idle");
                setReply("Voice uses Mandy's microphone once you're signed in. Type it here — this preview sends nothing out.");
              }
              return;
            }
            setPhase("listening");
            setReply("");
          }}
          onSend={send}
          onChoice={(c) => { void run(c.args, c.label); }}
          onConfirm={() => undefined}
          onCancelConfirm={() => setChoices([])}
          onStop={() => { setPhase("idle"); setChoices([]); setReply("Stopped."); }}
          onReconnect={() => setPhase("idle")}
        />
      )}
    </div>
  );
}
