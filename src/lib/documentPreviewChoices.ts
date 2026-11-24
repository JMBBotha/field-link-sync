import { isActiveCompany } from "@/lib/companyStatus";

/** One row in the tap-the-document choice. `primary` is the orange action. */
export interface PreviewChoice {
  id: string;
  label: string;
  primary?: boolean;
}

/**
 * True when we know this company cannot be written.
 * Missing status is active (same as is_company_writable's column default).
 * on_hold and archived are not writable.
 */
export function companyBlocksDocumentEdits(status: string | null | undefined, known: boolean): boolean {
  if (!known) return false;
  return !isActiveCompany({ status });
}

const VOID = new Set(["void", "cancelled", "canceled"]);

/**
 * Invoice preview choices. Drafts edit. Sent documents only offer the actions
 * already on the page (duplicate, and a credit note when that button exists).
 * A company that is not writable gets nothing — no edit, no write.
 */
export function invoicePreviewChoices(input: {
  status: string | null | undefined;
  companyWritable: boolean;
  canCreditNote: boolean;
}): PreviewChoice[] {
  if (!input.companyWritable) return [];
  const status = String(input.status || "draft").toLowerCase();
  if (status === "draft") return [{ id: "edit", label: "Edit invoice", primary: true }];
  if (VOID.has(status)) return [{ id: "duplicate", label: "Duplicate", primary: true }];
  const choices: PreviewChoice[] = [{ id: "duplicate", label: "Duplicate", primary: true }];
  if (input.canCreditNote) choices.push({ id: "credit-note", label: "Credit note" });
  return choices;
}

/**
 * Quote / estimate preview choices.
 * Editable quotes: return to the estimate editor, or the existing full builder.
 * Locked quotes: only the lock-banner actions that are already on the page.
 */
export function quotePreviewChoices(input: {
  companyWritable: boolean;
  canEdit: boolean;
  canUnlock: boolean;
  canRelock: boolean;
  canVariation: boolean;
  canCorrectClient: boolean;
  /** The lock banner is showing, so those buttons are in the page to press. */
  lockActionsLive: boolean;
}): PreviewChoice[] {
  if (!input.companyWritable) return [];
  if (input.canEdit) {
    return [
      { id: "edit", label: "Edit quote", primary: true },
      { id: "full-builder", label: "Full builder" },
    ];
  }
  if (!input.lockActionsLive) return [];
  const choices: PreviewChoice[] = [];
  if (input.canUnlock) choices.push({ id: "unlock", label: "Unlock to edit" });
  if (input.canVariation) choices.push({ id: "variation", label: "Create variation", primary: true });
  if (input.canCorrectClient) choices.push({ id: "client", label: "Edit client details" });
  if (input.canRelock) choices.push({ id: "relock", label: "Lock again" });
  if (choices.length && !choices.some((choice) => choice.primary)) choices[0] = { ...choices[0], primary: true };
  return choices;
}

/** Same credit-note gate as CreditNotesPanel: not a draft/void, balance still open, not a sales rep. */
export function canOfferCreditNote(input: {
  status: string | null | undefined;
  isSalesRep: boolean;
  outstanding: number;
}): boolean {
  const status = String(input.status || "draft").toLowerCase();
  if (input.isSalesRep) return false;
  if (status === "draft" || VOID.has(status)) return false;
  return input.outstanding > 0.005;
}

const INTERACTIVE = "a, button, input, textarea, select, label, summary, [role='button'], [role='link'], [role='menuitem'], [contenteditable='true'], [data-preview-pass]";

/**
 * A click on the preview opens the choice unless it landed on a real control
 * inside the preview (link, button, field).
 */
export function previewClickOpensChoice(target: EventTarget | null, surface: HTMLElement): boolean {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!el || !surface.contains(el)) return false;
  const hit = el.closest(INTERACTIVE);
  if (hit && surface.contains(hit)) return false;
  return true;
}
