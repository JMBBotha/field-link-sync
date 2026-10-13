import { supabase } from "@/integrations/supabase/client";
import { ToastAction } from "@/components/ui/toast";

/**
 * Labour check is a WARNING only (Johan 2026-10-13): it never blocks save, send, PDF or print.
 * The toast offers "Labour included" (stored on quotes.labour_included so it stops asking);
 * "Add labour" scrolls to the labour row.
 */
type ToastFn = (t: any) => unknown;

export async function markLabourIncluded(quoteId: string, included = true) {
  return (supabase.from("quotes") as any).update({ labour_included: included }).eq("id", quoteId);
}

export function warnMissingLabour(toast: ToastFn, missing: { id: string; name: string }[], quoteId?: string | null, onIncluded?: () => void) {
  if (!missing.length) return;
  const first = missing[0];
  toast({
    title: `No labour on ${first.id === "job" ? "this job" : first.name}${missing.length > 1 ? ` (+${missing.length - 1} more)` : ""}`,
    description: "Carrying on. If labour is included in the prices (or there is none), tap Labour included.",
    action: quoteId ? (
      <ToastAction altText="Labour included / no labour" onClick={() => { void markLabourIncluded(quoteId).then(() => onIncluded?.()); }}>
        Labour included
      </ToastAction>
    ) : (
      <ToastAction altText="Add labour" onClick={() => document.getElementById(`area-labour-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>Add labour</ToastAction>
    ),
  });
}
