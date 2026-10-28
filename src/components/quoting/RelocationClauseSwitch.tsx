import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { toast } from "sonner";
import { quoteHasRelocation } from "@/lib/relocationClause";

type Mode = "on" | "off" | null;

/**
 * Admin-only Auto / On / Off switch for the "Existing / relocated units" clause (Johan 2026-10-28).
 * Only switches the clause; the wording itself is company-wide (Settings > Terms & Conditions).
 * The database also refuses this change from non-admins (trg_quote_terms_guard).
 */
export default function RelocationClauseSwitch({ quoteId, value, lines, onChanged }: { quoteId: string; value: Mode; lines: Array<string | null | undefined>; onChanged?: () => void }) {
  const { isAdmin, loading } = useRole();
  const [busy, setBusy] = useState(false);
  if (loading || !isAdmin) return null;
  const detected = quoteHasRelocation(lines);
  const set = async (next: Mode) => {
    if (next === value) return;
    setBusy(true);
    const { error } = await (supabase.from("quotes") as any).update({ relocation_clause: next }).eq("id", quoteId);
    setBusy(false);
    if (error) { toast.error(error.message || "Couldn't change the clause"); return; }
    onChanged?.();
  };
  const opt = (m: Mode, label: string) => (
    <button key={label} type="button" disabled={busy} onClick={() => set(m)} data-testid={`reloc-${label.toLowerCase()}`}
      className={`px-2 py-0.5 text-xs font-medium ${value === m ? "bg-[#1B3A5C] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
      {label}
    </button>
  );
  return (
    <div data-testid="relocation-clause-switch" className="flex items-center gap-2 text-xs text-slate-600"
      title="Adds the 'Existing / relocated units' terms clause. Auto = on when a line removes, relocates or reinstalls an existing unit.">
      <span>Relocated-units clause{value == null ? ` (auto: ${detected ? "on" : "off"})` : ""}</span>
      <span className="inline-flex overflow-hidden rounded-md border border-slate-200">
        {opt(null, "Auto")}{opt("on", "On")}{opt("off", "Off")}
      </span>
    </div>
  );
}
