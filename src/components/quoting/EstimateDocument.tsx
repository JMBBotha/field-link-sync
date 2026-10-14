import { CanonicalAreaChoices, CanonicalAreaCreateControl } from "@/components/quote/AreaNameChips";
import QtyStepper from "./QtyStepper";
import { AreaNameLabel, isDefaultAreaName } from "@/components/quote/AreaNameLabel";
import { SpecialChip } from "@/components/specials/SpecialsUi";
import { useRef, useState, type ReactNode } from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight, Copy, Menu, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNewLineScroll } from "@/hooks/useNewLineScroll";
import { useIsPhone } from "@/hooks/useIsPhone";
import logo from "@/assets/logo.png";
import logoLight from "@/assets/brand/logo-light.png";
import { isMassairProfile } from "@/components/documents/BrandDocument";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import type { ClientRollupArea } from "@/lib/clientQuoteRollup";
import AreaLabourRow from "@/components/quoting/AreaLabourRow";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatRand } from "@/utils/formatRand";
import CompanyBlock from "@/components/shared/CompanyBlock";
import { cleanBanking } from "@/lib/companyIdentity";
import { profileBanking, type CompanyProfile } from "@/lib/companyProfiles";
import { useDocumentCompanyProfile } from "@/hooks/useDocumentCompanyProfile";
import { withEoe } from "@/lib/eoeClause";
import { planTermsSentence, type PaymentPlan } from "@/lib/paymentPlans";
import BrandDocument, { type BrandDocSection } from "@/components/documents/BrandDocument";
import { foldFlatLines } from "@/lib/clientQuoteRollup";

export interface EstimateDocLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  /** Quantity text override, e.g. "3 m" for per-metre trunking. */
  qtyText?: string | null;
  /** Catalog product image for the sales-card treatment (optional). */
  imageUrl?: string | null;
}

/** One editable line inside an area (staff edit mode only). */
export interface EstimateEditLine {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  imageUrl?: string | null;
  /** Standard-install role when this line belongs to an AC unit's install. */
  installRole?: string | null;
  /** Stable parent AC unit id from metadata.install.unit_item_id. */
  installUnitId?: string | null;
  /** "1 × 3 m length" for items sold per supplier length. */
  lengthLabel?: string | null;
  /** Per-metre trunking line: qty in metres (0.1 m steps). */
  perMetre?: boolean;
  itemNumber?: string | null;
  /** Piping kit row: the kit it was built from. */
  kitBundleId?: string | null;
  /** Per-metre kit: metres come from quote_items.length. */
  kitPerMetre?: boolean;
  kitLength?: number | null;
  /** Picked from catalog_services (no price in the catalogue). */
  isService?: boolean;
  /** Staff-only muted note next to the price (e.g. "cost R 1 234"); set by the staff builder only. */
  staffNote?: string | null;
  /** Staff-only warn chip: markup differs from the standard (warn only, never on the client PDF). */
  priceWarn?: string | null;
  /** Staff-only specials indicator (never on client PDF). */
  special?: { cost: number; endDate: string; pdfPath: string | null; applied: boolean } | null;
  /** Display-only short name (kit title / install companion); item_name is never rewritten unless edited. */
  displayName?: string | null;
  /** Unit next to qty, e.g. "3 m", "1 each", "0.5 × 3 m length", "3.5 h". */
  unitText?: string | null;
  /** Piping kit contents — read-only detail rows, not priced lines. */
  kitItems?: { name: string; qty: string }[] | null;
  /** AC unit line (Air Conditioning) — install materials group under it. */
  isAcUnit?: boolean;
  /** Kit / Consumables / Installation Kit line from item_type or is_bundle. */
  isInstallMaterial?: boolean;
  /** Labour line — never grouped. */
  isLabour?: boolean;
  labourAuto?: boolean;
  acUnitCount?: number;
}

/** One area section inside the quote body (staff edit mode only). */
export interface EstimateEditArea {
  id: string | null;
  name: string;
  lines: EstimateEditLine[];
  labourLines?: EstimateEditLine[];
  defaultLabourHours?: number;
}

/**
 * Edit affordances folded INTO the document. When absent the document renders
 * exactly as the read-only client-facing estimate.
 */
export interface EstimateEditing {
  areas: EstimateEditArea[];
  selectedLineId: string | null;
  onSelectLine: (id: string | null) => void;
  onLineChange: (
    id: string,
    patch: { item_name?: string; description?: string | null; quantity?: number; unit_price?: number },
  ) => void;
  onDeleteLine: (id: string) => void;
  /** Swap an install bracket line to another live bracket code. */
  onSwapBracket?: (id: string, code: string) => void;
  bracketOptions?: { code: string; label: string }[];
  /** Swap a piping kit row to another live kit (same metres, repriced from the book). */
  onSwapKit?: (id: string, bundleId: string) => void;
  kitOptions?: { id: string; label: string }[];
  /** Change a per-metre kit's length (metres); quantity stays 1. */
  onKitLengthChange?: (id: string, metres: number) => void;
  onRenameArea: (id: string, name: string) => void;
  onAddArea: (name?: string) => void | Promise<unknown>;
  /** Naming the orphan default section promotes it into a real area. */
  onNameDefaultArea?: (name: string) => void;
  /** Area whose name input should take focus (just-created area). */
  focusAreaId?: string | null;
  /** Delete an area (and its lines). Only shown for real (persisted) areas. */
  onDeleteArea?: (id: string) => void | Promise<void>;
  /** Area currently being built — its add bar is highlighted. */
  activeAreaId?: string | null;
  onSelectArea?: (id: string | null) => void;

  /** Per-area add controls (Add unit / service / material), rendered inside each area block. */
  renderAreaAdd?: (areaId: string | null) => ReactNode;
  /** Single inline creation control after all quote sections, before totals. */
  areaCreationControl?: ReactNode;
  collapsedAreaKeys?: Set<string>;
  onToggleArea?: (key: string) => void;
  /** Discount control rendered in the totals block. */
  discountControl?: ReactNode;
  /** Line ⋯ menu: move / duplicate into another real area. */
  onMoveLine?: (id: string, areaId: string) => void;
  onDuplicateLine?: (id: string, areaId: string) => void;
  onAddLabour?: (areaId: string) => void;
  labourRate?: number;
  onLabourChange?: (id: string, hours: number, rate?: number) => void;
  unassignedLabour?: EstimateEditLine[];
  /** Delete a labour line (every counted labour line must be removable). */
  onRemoveLabour?: (id: string) => void;
  /** Labour mode 'job': one Job labour row after the last area; areas show no labour row. */
  jobLabour?: { lines: EstimateEditLine[]; defaultHours: number; onAdd: () => void };
  /** Staff-only "Labour: one total for whole job" switch, under the last labour row (never printed). */
  labourModeToggle?: ReactNode;
  /** Keystroke-level, uncommitted edits (live client preview only; never written to the DB). */
  onDraft?: (id: string, patch: { item_name?: string; description?: string | null; unit_price?: number }) => void;
}


export interface EstimateDocumentProps {
  estimateNumber: string;
  issueDate: string;
  validUntil?: string | null;
  customerName: string;
  customerCompany?: string | null;
  customerAddress?: string | null;
  customerEmail?: string | null;
  /** Client's VAT number, printed under Prepared For when present. */
  customerVat?: string | null;
  customerPhone?: string | null;
  items: EstimateDocLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  notes?: string | null;
  termsText?: string | null;
  /** Discount applied to the subtotal before VAT (0 = none). */
  discountAmount?: number;
  discountLabel?: string | null;
  /**
   * Safe company snapshot for anonymous/public rendering (client quote page).
   * When supplied it replaces the authenticated company-settings lookup.
   */
  companyOverride?: {
    company_name?: string | null;
    physical_address?: string | null;
    vat_number?: string | null;
    banking_details?: Record<string, string | undefined> | null;
    default_deposit_percentage?: number | null;
    default_payment_terms_days?: number | null;
  } | null;
  /** The document's company (quote.company_id): header + banking come from its own record. */
  companyId?: string | null;
  /** Company record already in hand (public RPC); skips the lookup. */
  companyProfile?: Partial<CompanyProfile> | null;
  editing?: EstimateEditing;
  /**
   * Client-facing roll-up: one block per area (unit + blurb + single area
   * total). When supplied the read-only body renders these instead of the
   * itemised line table. Staff editing is unaffected.
   */
  clientAreas?: ClientRollupArea[];
  presentationMode?: "flat" | "clientRollup";
  /** Accounting step 1: the quote's payment plan (null = company deposit %). */
  paymentPlan?: PaymentPlan | null;
  /** "The units in this quote" cards: printed after the totals, before the terms. */
  unitCards?: ReactNode;
}


const formatCurrency = (amount: number) => {
  const n = Number(amount) || 0;
  const safe = Object.is(n, -0) || n === 0 ? 0 : n;
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(safe);
};

export type EstimateTableRow =
  | { kind: "line"; line: EstimateEditLine; installGroupId?: string }
  | { kind: "install-summary"; unitId: string; lines: EstimateEditLine[] };

const INSTALL_NAME_RE = /copper|arma ?flex|insulation|lasso|cable tie|trunking|end cap|bracket|flatback|docking channel|pvc pipe|pvc elbow|drain|piping kit/i;

/** True when a line counts as installation material (never labour, services or AC units). */
export function isEstimateInstallMaterial(line: EstimateEditLine): boolean {
  if (line.isLabour || line.isService || line.isAcUnit) return false;
  if (line.installRole) return true;
  if (line.isInstallMaterial) return true;
  if (line.kitBundleId) return true;
  return INSTALL_NAME_RE.test(line.name || "");
}

/**
 * Groups install materials under their AC unit (display order only).
 * Tagged lines go under their tagged unit; untagged ones under the nearest preceding
 * AC unit; with no unit before them, one group per area at the first such line.
 */
export function groupEstimateInstallLines(lines: EstimateEditLine[], areaKey = "none"): EstimateTableRow[] {
  const ids = new Set(lines.map((l) => l.id));
  const unitIds = new Set(lines.filter((l) => l.isAcUnit).map((l) => l.id));
  const groups = new Map<string, EstimateEditLine[]>();
  const add = (key: string, l: EstimateEditLine) => {
    const g = groups.get(key);
    if (g) g.push(l); else groups.set(key, [l]);
  };
  const assigned = new Map<string, string>();
  let lastUnit: string | null = null;
  for (const l of lines) {
    if (l.isAcUnit) { lastUnit = l.id; continue; }
    if (!isEstimateInstallMaterial(l)) continue;
    let key: string;
    if (l.installUnitId && ids.has(l.installUnitId) && l.installUnitId !== l.id) key = l.installUnitId;
    else if (lastUnit) key = lastUnit;
    else key = `area-${areaKey}`;
    assigned.set(l.id, key);
    add(key, l);
  }
  // Tagged children whose unit isn't flagged isAcUnit still group under that line.
  const rows: EstimateTableRow[] = [];
  const pushGroup = (key: string) => {
    const kids = groups.get(key);
    if (!kids?.length) return;
    rows.push({ kind: "install-summary", unitId: key, lines: kids });
    rows.push(...kids.map((child) => ({ kind: "line" as const, line: child, installGroupId: key })));
    groups.delete(key);
  };
  for (const l of lines) {
    const key = assigned.get(l.id);
    if (key) {
      if (key.startsWith("area-")) pushGroup(key);
      else if (!ids.has(key)) rows.push({ kind: "line", line: l });
      continue;
    }
    rows.push({ kind: "line", line: l });
    if (unitIds.has(l.id) || groups.has(l.id)) pushGroup(l.id);
  }
  return rows;
}

const lineAmount = (line: EstimateEditLine) =>
  line.perMetre
    ? Math.round(line.quantity * line.unit_price * 100 + 1e-6) / 100
    : line.quantity * line.unit_price;

/** Normalises a tax rate stored as 0.15 or 15 into a display percentage. */
const toPercent = (rate?: number | null) => {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 15;
  return n <= 1 ? Math.round(n * 10000) / 100 : n;
};

/**
 * Older quotes store a typed "Banking Details:" clause (6.1 Account Name ... 6.5 Branch Code) inside
 * terms_text. Banking now comes from the company record and is printed in its own "Banking Details"
 * block at the bottom of this document, so ONLY that clause's lines are replaced by a pointer to the
 * block (avoids two, possibly conflicting, account numbers). Everything before AND after it
 * (Deposit Reference, Confidentiality, Termination, Dispute Resolution, Importance of Servicing...)
 * is kept. Before 2026-10-12 this cut everything from "Banking Details" to the end.
 */
const BANKING_LINE = /^\s*(?:(\d+)\.\d+\s*)?(?:account\s*(?:name|type|holder|no\.?|number)?|acc(?:ount)?\s*no\.?|bank(?:\s*name)?|branch(?:\s*(?:code|name))?|swift|reference\s*:)\b[^\n]*$/i;
export const stripLegacyBanking = (terms?: string | null) => {
  if (!terms) return terms ?? null;
  const lines = terms.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:(\d+)[.)]?\s*)?banking\s*details\s*:?\s*(.*)$/i);
    if (!m) { out.push(lines[i]); continue; }
    let num = m[1] || "";
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && BANKING_LINE.test(lines[j])) {
      num = num || (lines[j].match(BANKING_LINE)?.[1] ?? "");
      j++;
    }
    out.push("Banking Details:");
    out.push(`${num ? `${num}.1 ` : ""}See the Banking Details below.`);
    i = j - 1;
  }
  const cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length > 0 ? cleaned : null;
};

const formatDate = (dateStr?: string | null) =>
  dateStr
    ? new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : "—";

/** Borderless inputs so the document still reads like a document while editing. */
/** Light client design tokens for the editor (look only). Montserrat with the same fallbacks as BrandDocument. */
const EDITOR_FONT = { fontFamily: "Montserrat, Arial, Helvetica, sans-serif" } as const;
const META_LABEL = "text-[10px] font-bold uppercase tracking-[0.14em] text-[#1AA7EC]";

const inputBase =
  "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-slate-200 focus:border-[#1AA7EC] focus:bg-white";

/**
 * FreshBooks-style estimate document.
 * Read-only for clients; with `editing` supplied it becomes the in-place
 * builder that sales uses (single surface, no floating editor card).
 */
const EstimateDocument = ({
  estimateNumber,
  issueDate,
  validUntil,
  customerName,
  customerCompany,
  customerAddress,
  customerEmail,
  customerVat,
  customerPhone,
  items,
  subtotal,
  taxRate,
  taxAmount,
  grandTotal,
  notes,
  termsText,
  discountAmount = 0,
  discountLabel,
  companyOverride,
  companyId,
  companyProfile,
  editing,
  clientAreas,
  presentationMode,
  paymentPlan,
  unitCards,
}: EstimateDocumentProps) => {
  const editRootRef = useRef<HTMLDivElement | null>(null);
  const flashId = useNewLineScroll(
    editing ? editing.areas.flatMap((a) => a.lines.map((l) => l.id)) : [],
    () => editRootRef.current,
  );
  const [namingAreas, setNamingAreas] = useState<Set<string>>(new Set());
  const [openKits, setOpenKits] = useState<Record<string, boolean>>({});
  const [openInstallGroups, setOpenInstallGroups] = useState<Record<string, boolean>>({});
  const isPhone = useIsPhone();
  const rollup = !editing && presentationMode === "clientRollup" ? clientAreas ?? [] : null;
  const { settings: authedSettings } = useCompanySettings();
  const settings = companyOverride
    ? {
        company_name: companyOverride.company_name || "",
        physical_address: companyOverride.physical_address || "",
        vat_number: companyOverride.vat_number || "",
        default_deposit_percentage: Number(companyOverride.default_deposit_percentage) || 70,
        default_payment_terms_days: Number(companyOverride.default_payment_terms_days) || 30,
        banking_details: companyOverride.banking_details || {},
      }
    : authedSettings;
  // Company record first (Johan 2026-10-12): public pages pass it in; staff pages load it (RLS-scoped).
  const record = useDocumentCompanyProfile(companyId, companyProfile, !companyOverride || !!companyId);
  const recBank = profileBanking(record);
  const setBank = cleanBanking(settings.banking_details);
  const bank = recBank
    ? {
        account_name: recBank.account_name || setBank.account_name,
        bank_name: recBank.bank_name || setBank.bank_name,
        account_number: recBank.account_number || setBank.account_number,
        branch_code: recBank.branch_code || setBank.branch_code,
        account_type: recBank.account_type || setBank.account_type,
      }
    : setBank;

  const vatPercent = toPercent(taxRate);
  // Editor header logo = the Light client document's logo (record logo, else Massair artwork).
  const editorLogo = ((record as any)?.logo_url as string | undefined) || (isMassairProfile(record) ? logoLight : null);
  const accountType = bank.account_type;
  const cleanTerms = stripLegacyBanking(termsText);

  // Client-facing (read-only) output = the Light/Bold document (Johan 2026-10-13). Staff editing keeps its own surface.
  if (!editing) {
    const qty = (n: number) => String(Number.isInteger(n) ? n : Math.round(n * 100) / 100);
    const sections: BrandDocSection[] = rollup
      ? rollup.map((area, i) => ({
          key: area.areaId ?? `general-${i}`,
          title: rollup.length > 1 || area.areaName !== "General" ? area.areaName : null,
          subtotal: area.areaTotal,
          lines: area.items.map((it, j) => ({ key: it.id ?? `${i}-${j}`, quantity: it.qtyText || qty(it.quantity), code: it.code, name: it.name, description: it.description, rate: it.unitPrice, total: it.lineTotal })),
        }))
      : [{ key: "all", lines: foldFlatLines(items.map((it) => { const [name, ...rest] = it.description.split("\n"); return { name, description: rest.join("\n") || null, quantity: it.quantity, unit_price: it.unit_price, amount: it.amount, qtyText: it.qtyText || null }; })).map((l, j) => ({ key: String(j), quantity: l.qtyText || qty(l.quantity), name: l.name, description: l.description, rate: l.unit_price, total: l.amount })) }];
    const terms = cleanTerms || `This estimate is valid for 30 days from the date of issue. All prices exclude VAT, which is shown separately at ${vatPercent}%. ${planTermsSentence(paymentPlan, settings.default_deposit_percentage, settings.default_payment_terms_days)}`;
    const bankLine = [bank.account_name, bank.bank_name, bank.account_type && `${bank.account_type} account`, bank.account_number, bank.branch_code && `Branch ${bank.branch_code}`].filter(Boolean).join(" · ");
    return (
      <BrandDocument
        docType="quote"
        captureRoot="estimate"
        title="QUOTATION"
        number={estimateNumber}
        profile={record}
        partyLabel="Prepared for"
        partyName={customerName}
        partyLines={[customerCompany, customerAddress, customerEmail, customerPhone]}
        partyVat={customerVat}
        meta={[["Quote No", estimateNumber], ["Date", formatDate(issueDate)], ["Valid until", validUntil ? formatDate(validUntil) : "30 days"]]}
        sections={sections.filter((sec) => sec.lines.length)}
        totals={[
          { label: "Subtotal excl VAT", value: subtotal },
          ...(discountAmount > 0 ? [{ label: `Discount${discountLabel ? ` (${discountLabel})` : ""}`, value: discountAmount, negative: true }] : []),
          { label: `VAT ${vatPercent}%`, value: taxAmount },
        ]}
        grandLabel="Quote total incl VAT"
        grandTotal={grandTotal}
        afterTotals={unitCards}
        cards={[
          ...(notes ? [{ title: "Overview", body: <p className="whitespace-pre-line">{notes}</p> }] : []),
          { title: "Payment", body: <p>{planTermsSentence(paymentPlan, settings.default_deposit_percentage, settings.default_payment_terms_days)}</p> },
          { title: "Banking", body: <p>{bankLine || "—"}. Reference: quote number.</p> },
        ]}
        terms={terms}
      />
    );
  }

  return (
    <div
      ref={editRootRef}
      data-pdf-capture-root="estimate"
      className={`estimate-document pdf-page mx-auto w-full text-slate-800 shadow-sm ring-1 ring-slate-200 print:bg-white print:shadow-none print:ring-0 ${
        editing ? "estimate-editing bg-slate-100" : "bg-white"
      }`}
    >

      <div className="p-8 sm:p-10" style={EDITOR_FONT}>
        {/* ── Header: Light client design (Johan 14 Oct, step 1 — look only) ── */}
        <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center" data-testid="editor-brand-header">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {editorLogo ? (
              <img src={editorLogo} alt="Company logo" className="h-20 w-auto object-contain sm:h-24" />
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-[#0B4FA8] p-3 shadow-sm">
                <img src={logo} alt="Company logo" className="h-16 w-auto object-contain" />
              </div>
            )}
            <div className="border-l-2 border-[#1AA7EC] pl-4 text-[#0B4FA8] [&_*]:!text-[#0B4FA8] [&_*]:!text-left [&_*]:!items-start [&_*]:!justify-start">
              <CompanyBlock profile={record} fetchProfile={false} />
            </div>
          </div>
          <div className="sm:text-right">
            <h1 className="text-[26px] font-extrabold uppercase leading-tight tracking-[0.06em] text-[#0B4FA8]">
              {editing ? "Estimate" : customerName ? `${customerName} — Quote / Proposal` : "Quote / Proposal"}
            </h1>
            <p className="mt-1 text-[13px] font-semibold text-[#F7941D]">{estimateNumber}</p>
          </div>
        </div>
        <div aria-hidden className="mt-4 h-[3px]" style={{ background: "linear-gradient(90deg,#1AA7EC 75%,#F7941D 75%)" }} />

        {/* ── Meta row ── */}
        <div className="mt-4 grid grid-cols-2 gap-6 pb-6 sm:grid-cols-4">
          <div>
            <p className={META_LABEL}>Prepared For</p>
            <p className="mt-1 text-[14px] font-bold text-[#0B4FA8]">{customerName}</p>
            {customerCompany && <p className="text-[12px] text-slate-600">{customerCompany}</p>}
            {customerAddress && <p className="text-[12px] leading-snug text-slate-600">{customerAddress}</p>}
            {customerEmail && <p className="text-[12px] text-slate-600">{customerEmail}</p>}
            {customerPhone && <p className="text-[12px] text-slate-600">{customerPhone}</p>}
            {customerVat && customerVat.trim() && <p className="text-[12px] text-slate-600" data-testid="customer-vat">VAT No {customerVat.trim()}</p>}
          </div>
          <div>
            <p className={META_LABEL}>Date</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-800">{formatDate(issueDate)}</p>
            <p className={`mt-2 ${META_LABEL}`}>Valid Until</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-800">
              {validUntil ? formatDate(validUntil) : "30 days"}
            </p>
          </div>
          <div>
            <p className={META_LABEL}>Estimate Number</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-800">{estimateNumber}</p>
          </div>
          <div className="sm:text-right">
            <p className={META_LABEL}>Total (ZAR)</p>
            <p className="mt-1 text-2xl font-extrabold text-[#0B4FA8]">{formatCurrency(grandTotal)}</p>
          </div>
        </div>

        {/* ── Line items ── */}
        {editing ? (
          <div data-solid data-paper className="option1-solid mt-6 space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5" data-testid="estimate-areas-card">
            {!editing.areas.some((area) => area.id) && editing.areas.every((area) => area.lines.length === 0) && (
              <div className="w-full print:hidden" data-pdf-hide data-html2canvas-ignore data-testid="inline-estimate-area-create">
                {editing.areaCreationControl ?? <CanonicalAreaCreateControl existingNames={[]} onCreate={editing.onAddArea} />}
              </div>
            )}
            {editing.areas.filter((area) => !(!area.id && area.lines.length === 0)).map((area) => {
              const areaKey = area.id ?? "unassigned";
              const canCollapse = editing.collapsedAreaKeys !== undefined && !!editing.onToggleArea;
              const collapsed = canCollapse && editing.collapsedAreaKeys?.has(areaKey);
              return (
              <section
                key={areaKey}
                data-area-id={areaKey}
                data-area-collapsed={collapsed ? "true" : undefined}
                onFocus={() => editing.onSelectArea?.(area.id)}
                onClick={() => editing.onSelectArea?.(area.id)}
                className="option1-area pb-0 print:pb-0"
              >
                <div className="option1-title-row flex items-center gap-2 border-b pb-3">
                  {area.id ? (
                    <AreaNameLabel
                      key={`${area.id}-${area.name}`}
                      name={area.name}
                      choicesEditing
                      onEditingChange={() => setNamingAreas((current) => new Set(current).add(areaKey))}
                      onRename={(v) => editing.onRenameArea(area.id as string, v)}
                      className="text-xl font-bold normal-case"
                    />
                  ) : (
                    <AreaNameLabel
                      key={`default-${area.name}`}
                      name={area.name}
                      choicesEditing
                      isDefault={area.name === "Add items to quote" || undefined}
                      onEditingChange={() => setNamingAreas((current) => new Set(current).add(areaKey))}
                      onRename={(v) => editing.onNameDefaultArea?.(v)}
                      className="text-xl font-bold normal-case"
                    />
                  )}
                  {canCollapse && area.lines.length > 0 && (
                    <Button
                      variant="ghost" data-solid
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={(e) => {
                        e.stopPropagation();
                        editing.onToggleArea?.(areaKey);
                      }}
                      className="option1-collapse ml-auto h-9 shrink-0 px-1 text-xs font-normal print:hidden"
                      data-pdf-hide
                      data-html2canvas-ignore
                    >
                      {collapsed ? `Show ${area.lines.length} item${area.lines.length === 1 ? "" : "s"}` : "Hide items"}
                    </Button>
                  )}
                  {area.id && editing.onDeleteArea && (
                    <Button
                      variant="ghost" size="icon" data-solid data-html2canvas-ignore
                      type="button"
                      aria-label={`Delete area ${area.name}`}
                      title="Delete this area and its lines"
                      onClick={(e) => {
                        e.stopPropagation();
                        editing.onDeleteArea?.(area.id as string);
                      }}
                      className={`${canCollapse && area.lines.length > 0 ? "" : "ml-auto"} option1-delete h-7 w-7 shrink-0 print:hidden`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {(isDefaultAreaName(area.name) || area.name === "Add items to quote" || namingAreas.has(areaKey)) && (
                  <div className="mt-4 print:hidden" data-html2canvas-ignore>
                    <CanonicalAreaChoices existingNames={editing.areas.filter((other) => other.id !== area.id).map((other) => other.name)} onCreate={(name) => {
                      if (area.id) editing.onRenameArea(area.id, name);
                      else editing.onNameDefaultArea?.(name);
                      setNamingAreas((current) => { const next = new Set(current); next.delete(areaKey); return next; });
                    }} />
                  </div>
                )}
                {editing.renderAreaAdd && (
                  <div className="mt-4 print:hidden" data-pdf-hide data-html2canvas-ignore data-area-add-root>{editing.renderAreaAdd(area.id)}</div>
                )}

                <table className={`estimate-lines mt-4 w-full border-collapse text-[12px] ${collapsed ? "hidden print:table" : ""}`}>

                  <thead>
                    <tr className="option1-table-header text-[11px] uppercase tracking-wider max-sm:portrait:hidden">
                      <th className="rounded-l py-2 pl-2 text-left font-semibold">Description</th>
                      <th className="w-24 py-2 text-right font-semibold">Rate</th>
                       <th className="w-16 py-2 text-right font-semibold">QTY</th>
                      <th className="w-28 py-2 text-right font-semibold">Line Total</th>
                      <th className="w-8 print:hidden" />
                    </tr>
                  </thead>
                  <tbody>
                    {groupEstimateInstallLines(area.lines, area.id ?? "none").map((row) => {
                      if (row.kind === "install-summary") {
                        const open = !!openInstallGroups[row.unitId];
                        const total = row.lines.reduce((sum, child) => sum + lineAmount(child), 0);
                        return (
                          <tr key={`install-summary-${row.unitId}`} className="estimate-install-summary print:hidden" data-html2canvas-ignore>
                            <td colSpan={5} className="py-3">
                              <Button
                                variant="ghost" data-solid
                                type="button"
                                aria-label={open ? "Hide installation materials" : "Show installation materials"}
                                aria-expanded={open}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenInstallGroups((current) => ({ ...current, [row.unitId]: !current[row.unitId] }));
                                }}
                                className="option1-install-bar flex h-auto min-h-10 w-full flex-wrap justify-start gap-1 rounded-md px-3 py-2 text-left text-xs"
                              >
                                {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                <span className="font-semibold">Installation materials</span>
                                <span>· {row.lines.length} items · {formatRand(total)}</span>
                              </Button>
                            </td>
                          </tr>
                        );
                      }
                      const line = row.line;
                      const selected = editing.selectedLineId === line.id;
                      return (
                        <tr
                          key={line.id}
                          data-line-id={line.id}
                          data-install-role={line.installRole || undefined}
                          data-install-collapsed={row.installGroupId && !openInstallGroups[row.installGroupId] ? "true" : undefined}
                          onFocus={() => editing.onSelectLine(line.id)}
                          onClick={() => editing.onSelectLine(line.id)}
                          className={`estimate-line border-b border-slate-100 align-top ${
                            row.installGroupId && !openInstallGroups[row.installGroupId] ? "hidden print:table-row" : ""
                          } ${
                            selected ? "bg-sky-50/60 print:bg-transparent" : ""
                          } ${flashId === line.id ? "animate-pulse bg-amber-50 print:bg-transparent" : ""}`}
                        >
                          <td className="py-2 pr-4">
                            <div className="flex items-start gap-2">
                              {line.imageUrl && (
                                <img
                                  src={line.imageUrl}
                                  alt={line.name}
                                  className="mt-0.5 h-10 w-10 shrink-0 rounded border border-slate-200 bg-white object-contain"
                                  loading="lazy"
                                />
                              )}
                              <div className={`min-w-0 flex-1 ${line.installRole ? "border-l-2 border-sky-200 pl-2" : ""}`}>
                                {line.kitBundleId && !line.installRole && editing.onSwapKit && editing.kitOptions && (
                                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-sky-700 print:hidden">
                                    <span>Kit</span>
                                    <select
                                      aria-label="Swap kit"
                                      value={line.kitBundleId}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => editing.onSwapKit?.(line.id, e.target.value)}
                                      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] normal-case tracking-normal text-slate-700"
                                    >
                                      {!editing.kitOptions.some((o) => o.id === line.kitBundleId) && <option value={line.kitBundleId}>{line.name}</option>}
                                      {editing.kitOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    </select>
                                  </div>
                                )}
                                {line.installRole && (
                                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-sky-700 print:hidden">
                                    <span>Install</span>
                                    {line.lengthLabel && <span className="normal-case tracking-normal text-slate-500">{line.lengthLabel}</span>}
                                    {line.installRole === "bracket" && editing.onSwapBracket && editing.bracketOptions && (
                                      <select
                                        aria-label="Swap bracket"
                                        value={line.itemNumber || ""}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => editing.onSwapBracket?.(line.id, e.target.value)}
                                        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] normal-case tracking-normal text-slate-700"
                                      >
                                        {!editing.bracketOptions.some((o) => o.code === line.itemNumber) && <option value={line.itemNumber || ""}>{line.itemNumber}</option>}
                                        {editing.bracketOptions.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                                      </select>
                                    )}
                                    {line.installRole === "piping_kit" && line.kitBundleId && editing.onSwapKit && editing.kitOptions && (
                                      <select
                                        aria-label="Swap kit"
                                        value={line.kitBundleId}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => editing.onSwapKit?.(line.id, e.target.value)}
                                        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] normal-case tracking-normal text-slate-700"
                                      >
                                        {!editing.kitOptions.some((o) => o.id === line.kitBundleId) && <option value={line.kitBundleId}>{line.name}</option>}
                                        {editing.kitOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                                      </select>
                                    )}
                                  </div>
                                )}
                                {!line.installRole && line.perMetre && line.lengthLabel && (
                                  <div className="text-[10px] text-slate-500 print:hidden">{line.lengthLabel}</div>
                                )}
                                <div className="flex items-center gap-1">
                                {line.kitItems && line.kitItems.length > 0 && (
                                  <button
                                    type="button"
                                    aria-label={openKits[line.id] ? "Hide kit contents" : "Show kit contents"}
                                    aria-expanded={!!openKits[line.id]}
                                    onClick={(e) => { e.stopPropagation(); setOpenKits((o) => ({ ...o, [line.id]: !o[line.id] })); }}
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 print:hidden"
                                  >
                                    {openKits[line.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </button>
                                )}
                                <div className="option1-line-copy min-w-0 text-sm leading-relaxed">
                                  <span key={`${line.id}-name-${line.displayName ?? ""}`} contentEditable suppressContentEditableWarning role="textbox" aria-label="Line name" title={line.displayName ? line.name : undefined}
                                    onInput={(event) => { const value = event.currentTarget.textContent?.trim(); if (value) editing.onDraft?.(line.id, { item_name: value }); }}
                                    onBlur={(event) => { const value = event.currentTarget.textContent?.trim(); if (value && value !== (line.displayName || line.name)) editing.onLineChange(line.id, { item_name: value }); }}
                                    className="line-name font-bold outline-none">{line.displayName || line.name}</span>
                                  <span> — </span>
                                  <span key={`${line.id}-desc-${line.description ?? ""}`} contentEditable suppressContentEditableWarning role="textbox" aria-label="Line description"
                                    onInput={(event) => editing.onDraft?.(line.id, { description: event.currentTarget.textContent || null })}
                                    onBlur={(event) => { const value = event.currentTarget.textContent || ""; if (value !== (line.description ?? "")) editing.onLineChange(line.id, { description: value || null }); }}
                                    className="line-desc outline-none">{line.description || ""}</span>
                                </div>
                                </div>
                                {line.kitItems && openKits[line.id] && (
                                  <ul data-testid="kit-contents" className="mb-1 ml-7 space-y-0.5 text-[11px] text-slate-500">
                                    {line.kitItems.map((k, idx) => (
                                      <li key={idx} className="flex justify-between gap-2"><span>{k.name}</span>{k.qty && <span className="shrink-0">× {k.qty}</span>}</li>
                                    ))}
                                  </ul>
                                )}

                              </div>
                            </div>
                          </td>
                          <td className="py-2 text-right">
                            <input
                              key={`${line.id}-price`}
                              type="number"
                              step="0.01"
                              defaultValue={line.unit_price}
                              onInput={(e) => { const v = Number(e.currentTarget.value); if (Number.isFinite(v)) editing.onDraft?.(line.id, { unit_price: v }); }}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v !== line.unit_price) {
                                  editing.onLineChange(line.id, { unit_price: v });
                                }
                              }}
                              className={`${inputBase} line-price text-right text-slate-700`}
                            />
                            {line.staffNote && (
                              <div data-html2canvas-ignore className="text-[10px] text-slate-400 print:hidden">{line.staffNote}</div>
                            )}
                            {line.special && (
                              <div><SpecialChip cost={line.special.cost} endDate={line.special.endDate} pdfPath={line.special.pdfPath} applied={line.special.applied} /></div>
                            )}
                            {line.priceWarn && (
                              <div data-html2canvas-ignore data-testid="markup-warn" className="mt-0.5 inline-block rounded-full border border-amber-400 bg-amber-50 px-1.5 text-[10px] text-amber-800 print:hidden">⚠ {line.priceWarn}</div>
                            )}
                            {line.isService && !line.unit_price && (
                              <div className="text-[10px] italic text-slate-400 print:hidden">price not set</div>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            {line.kitBundleId && line.kitPerMetre && editing.onKitLengthChange ? (
                              <div className="flex items-center justify-end">
                                <QtyStepper value={line.kitLength ?? 3} min={0.1} step={1} ariaLabel="Kit length (m)" unit="m"
                                  onCommit={(v) => editing.onKitLengthChange?.(line.id, v)} />
                              </div>
                            ) : (
                            <>
                            <QtyStepper value={line.quantity} min={line.perMetre ? 0.1 : 0} step={1}
                              ariaLabel={line.perMetre ? "Metres" : "Quantity"}
                              inputProps={{ "data-line-qty": line.id }}
                              onCommit={(v) => editing.onLineChange(line.id, { quantity: v })} />
                            <span className="hidden print:inline">{line.quantity}</span>
                            </>
                            )}
                            {line.unitText && !(line.kitBundleId && line.kitPerMetre && editing.onKitLengthChange) && (
                              <div data-testid="qty-unit" className="whitespace-nowrap text-[10px] text-slate-500 print:hidden">{line.unitText}</div>
                            )}
                          </td>
                          <td className="line-total py-2 text-right font-bold text-slate-900">
                            {formatRand(lineAmount(line))}
                          </td>
                          <td className="py-2 text-right print:hidden">
                            <div className="flex items-center justify-end gap-1 max-sm:flex-col max-sm:items-end">
                            {(editing.onMoveLine || editing.onDuplicateLine) && editing.areas.some((a) => a.id && a.id !== area.id) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button type="button" aria-label="Line options" title="Line options" data-testid="line-options" onClick={(e) => e.stopPropagation()}
                                    className="line-options inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-400 bg-white text-slate-800 hover:bg-slate-100">
                                    <Menu className="h-5 w-5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" sideOffset={6} collisionPadding={8} data-testid="line-options-menu" className="min-w-[13rem] max-w-[calc(100vw-1rem)] p-1" onClick={(e) => e.stopPropagation()}>
                                  {editing.onMoveLine && <DropdownMenuLabel className="flex items-center gap-2 text-sm font-semibold"><ArrowRightLeft className="h-4 w-4" />Move to…</DropdownMenuLabel>}
                                  {editing.onMoveLine && editing.areas.filter((a) => a.id && a.id !== area.id).map((a) => (
                                    <DropdownMenuItem key={`m-${a.id}`} className="min-h-11 pl-8 text-sm" onSelect={() => editing.onMoveLine?.(line.id, a.id as string)}>{a.name}</DropdownMenuItem>
                                  ))}
                                  {editing.onMoveLine && editing.onDuplicateLine && <DropdownMenuSeparator />}
                                  {editing.onDuplicateLine && <DropdownMenuLabel className="flex items-center gap-2 text-sm font-semibold"><Copy className="h-4 w-4" />Duplicate to…</DropdownMenuLabel>}
                                  {editing.onDuplicateLine && editing.areas.filter((a) => a.id).map((a) => (
                                    <DropdownMenuItem key={`d-${a.id}`} className="min-h-11 pl-8 text-sm" onSelect={() => editing.onDuplicateLine?.(line.id, a.id as string)}>{a.name}{a.id === area.id ? " (this area)" : ""}</DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <button
                              type="button"
                              aria-label="Remove line"
                              title="Remove line"
                              onClick={() => editing.onDeleteLine(line.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-700 shadow-sm hover:bg-red-100 hover:text-red-800"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {area.id && !editing.jobLabour && editing.onAddLabour && editing.onLabourChange && (
                  <AreaLabourRow
                    areaId={area.id}
                    areaName={area.name}
                    lines={area.labourLines || []}
                    defaultHours={area.defaultLabourHours || 0}
                    defaultRate={editing.labourRate}
                    onAdd={() => editing.onAddLabour?.(area.id as string)}
                    onChange={editing.onLabourChange}
                    onRemove={editing.onRemoveLabour}
                  />
                )}
              </section>
              );
            })}

            {editing.jobLabour && editing.onLabourChange && (
              <section data-testid="job-labour" className="option1-area pb-0 print:pb-0">
                <AreaLabourRow
                  areaId="job"
                  areaName="the job"
                  title="Job labour"
                  lines={editing.jobLabour.lines}
                  defaultHours={editing.jobLabour.defaultHours}
                  defaultRate={editing.labourRate}
                  onAdd={editing.jobLabour.onAdd}
                  onChange={editing.onLabourChange}
                  onRemove={editing.onRemoveLabour}
                  editTotal
                />
              </section>
            )}
            {editing.labourModeToggle}

            {!!editing.unassignedLabour?.length && (
              <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 print:hidden" data-testid="unassigned-labour">
                <p className="mb-2 font-semibold">Unassigned labour</p>
                {editing.unassignedLabour.map((line) => (
                  <div key={line.id} className="grid items-center gap-2 border-t border-amber-200 py-2 first:border-0 sm:grid-cols-[1fr_100px_120px_auto]">
                    <span>{line.name}</span>
                    <Input aria-label="Unassigned labour hours" type="number" min="0" step="0.5" defaultValue={line.quantity} onBlur={(e) => editing.onLabourChange?.(line.id, Number(e.target.value))} className="h-8 text-right" />
                    <Input aria-label="Unassigned labour rate" type="number" min="0" step="0.01" defaultValue={line.unit_price} onBlur={(e) => editing.onLabourChange?.(line.id, line.quantity, Number(e.target.value))} className="h-8 text-right" />
                    {editing.onRemoveLabour && <button type="button" aria-label="Remove unassigned labour" onClick={() => editing.onRemoveLabour?.(line.id)} className="px-2 text-[11px] underline">Remove</button>}
                  </div>
                ))}
              </div>
            )}
            {(editing.areas.some((area) => area.id) || editing.areas.some((area) => area.lines.length > 0)) && (
              <div className="w-full print:hidden" data-pdf-hide data-html2canvas-ignore data-testid="inline-estimate-area-create">
                {editing.areaCreationControl ?? (
                  <CanonicalAreaCreateControl existingNames={editing.areas.map((area) => area.name)} onCreate={editing.onAddArea} />
                )}
              </div>
            )}
          </div>

        ) : rollup ? (
          <div className="mt-8 space-y-4">
            {rollup.map((area, idx) => (
              <section key={area.areaId ?? `general-${idx}`} className="border-b border-slate-200 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#0B4FA8]">{area.areaName}</h2>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">{area.isJobLabour ? "Total" : "Area total"}</p>
                    <p className="text-[15px] font-bold text-slate-900">{formatCurrency(area.areaTotal)}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-3">
                  {area.units.map((unit, ui) => (
                    <div key={ui} className="flex items-start gap-3">
                      {unit.imageUrl && (
                        <img
                          src={unit.imageUrl}
                          alt={unit.unitName}
                          className="h-16 w-16 shrink-0 rounded border border-slate-200 bg-white object-contain"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-slate-800">{unit.unitName}</p>
                        {unit.unitDescription && (
                          <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-slate-500">
                            {unit.unitDescription}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  {area.hasInstallExtras && (
                    <p className="text-[11px] italic text-slate-500">{area.hasLabour === false ? "Installed incl. piping & materials" : "Installed incl. piping, materials & labour"}</p>
                  )}
                </div>
              </section>
            ))}
            {rollup.length === 0 && <p className="py-6 text-center text-slate-400">No line items</p>}
          </div>
        ) : (
          <table className="mt-8 w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-2 text-left font-semibold">Description</th>
                <th className="py-2 text-right font-semibold">Rate</th>
                <th className="py-2 text-right font-semibold">Qty</th>
                <th className="py-2 text-right font-semibold">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const [name, ...detailLines] = item.description.split("\n");
                return (
                  <tr key={idx} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-4 text-slate-800">
                      <div className="flex items-start gap-3">
                        {item.imageUrl && (
                          <img
                            src={item.imageUrl}
                            alt={name}
                            className="h-12 w-12 shrink-0 rounded border border-slate-200 bg-white object-contain"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium">{name}</p>
                          {detailLines.map((line, li) => (
                            <p key={li} className="mt-0.5 text-[11px] text-slate-500">{line}</p>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-right text-slate-600">{formatCurrency(item.unit_price)}{item.qtyText ? " / m" : ""}</td>
                    <td className="py-3 text-right text-slate-600">{item.qtyText || item.quantity}</td>
                    <td className="py-3 text-right font-medium text-slate-900">{formatCurrency(item.amount)}</td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">No line items</td>
                </tr>
              )}
            </tbody>
          </table>
        )}


        {/* ── Totals: Light client design (look only) ── */}
        <div className="mt-6 flex justify-end" data-testid="estimate-totals">
          <div className="w-full max-w-[340px] text-[12.5px]">
            <div className="flex justify-between px-2 py-1.5 text-slate-700">
              <span>Subtotal</span>
              <span className="font-semibold">{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between px-2 py-1.5 text-slate-700">
                <span>Discount{discountLabel ? ` (${discountLabel})` : ""}</span>
                <span className="font-semibold">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            {editing?.discountControl && <div className="px-2 print:hidden">{editing.discountControl}</div>}
            <div className="flex justify-between px-2 py-1.5 text-slate-700">
              <span>VAT ({vatPercent}%)</span>
              <span className="font-semibold">{formatCurrency(taxAmount)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-l-[5px] border-[#F7941D] bg-[#1AA7EC] px-3 py-2 text-[14.5px] font-extrabold text-white">
              <span>Total (ZAR)</span>
              <span className="text-lg">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        </div>

        {unitCards}

        {/* ── Footer ── */}
        <div className="mt-10 space-y-5 border-t border-slate-200 pt-6 text-[11px] leading-relaxed text-slate-600">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terms</p>
            <p className="mt-1 whitespace-pre-line">
              {withEoe(cleanTerms ||
                `This estimate is valid for 30 days from the date of issue. All prices exclude VAT, which is shown separately at ${vatPercent}%. ${planTermsSentence(paymentPlan, settings.default_deposit_percentage, settings.default_payment_terms_days)}`, settings.company_name, "quote")}
            </p>
          </div>

          {notes && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Notes</p>
              <p className="mt-1 whitespace-pre-line">{notes}</p>
            </div>
          )}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Banking Details</p>
            <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              <p><span className="text-slate-400">Account Name: </span>{bank.account_name}</p>
              <p><span className="text-slate-400">Bank: </span>{bank.bank_name || "—"}</p>
              <p><span className="text-slate-400">Account: </span>{bank.account_number || "—"}</p>
              <p><span className="text-slate-400">Branch Code: </span>{bank.branch_code || "—"}</p>
              <p><span className="text-slate-400">Type: </span>{accountType || "—"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EstimateDocument;
