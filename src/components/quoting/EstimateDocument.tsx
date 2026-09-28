import { AreaNameLabel } from "@/components/quote/AreaNameLabel";
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNewLineScroll } from "@/hooks/useNewLineScroll";
import logo from "@/assets/logo.png";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import type { ClientRollupArea } from "@/lib/clientQuoteRollup";

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
}

/** One area section inside the quote body (staff edit mode only). */
export interface EstimateEditArea {
  id: string | null;
  name: string;
  lines: EstimateEditLine[];
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
  onAddArea: () => void;
  /** Naming the orphan default section promotes it into a real area. */
  onNameDefaultArea?: (name: string) => void;
  /** Area whose name input should take focus (just-created area). */
  focusAreaId?: string | null;
  /** Delete an area (and its lines). Only shown for real (persisted) areas. */
  onDeleteArea?: (id: string) => void;
  /** Area currently being built — its add bar is highlighted. */
  activeAreaId?: string | null;
  onSelectArea?: (id: string | null) => void;

  /** Slim add-item / add-service bar rendered below EACH area's lines. */
  renderAddBar?: (areaId: string | null) => ReactNode;
  /** Discount control rendered in the totals block. */
  discountControl?: ReactNode;
  /** Line ⋯ menu: move / duplicate into another real area. */
  onMoveLine?: (id: string, areaId: string) => void;
  onDuplicateLine?: (id: string, areaId: string) => void;
}


export interface EstimateDocumentProps {
  estimateNumber: string;
  issueDate: string;
  validUntil?: string | null;
  customerName: string;
  customerCompany?: string | null;
  customerAddress?: string | null;
  customerEmail?: string | null;
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
  editing?: EstimateEditing;
  /**
   * Client-facing roll-up: one block per area (unit + blurb + single area
   * total). When supplied the read-only body renders these instead of the
   * itemised line table. Staff editing is unaffected.
   */
  clientAreas?: ClientRollupArea[];
  presentationMode?: "flat" | "clientRollup";
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
 * Older quotes stored a hard-coded banking-details block inside terms_text.
 * Banking details now come from company settings (single source of truth), so
 * strip any legacy banking block out of the terms copy to avoid showing two
 * conflicting account numbers.
 */
const stripLegacyBanking = (terms?: string | null) => {
  if (!terms) return terms ?? null;
  const cleaned = terms
    .replace(/\n?\s*banking\s*details\s*:?[\s\S]*$/i, "")
    .trimEnd();
  return cleaned.length > 0 ? cleaned : null;
};

const formatDate = (dateStr?: string | null) =>
  dateStr
    ? new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : "—";

/** Borderless inputs so the document still reads like a document while editing. */
const inputBase =
  "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-slate-200 focus:border-[#1B3A5C] focus:bg-white";

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
  editing,
  clientAreas,
  presentationMode,
}: EstimateDocumentProps) => {
  const editRootRef = useRef<HTMLDivElement | null>(null);
  const flashId = useNewLineScroll(
    editing ? editing.areas.flatMap((a) => a.lines.map((l) => l.id)) : [],
    () => editRootRef.current,
  );
  const [openKits, setOpenKits] = useState<Record<string, boolean>>({});
  const [openInstallGroups, setOpenInstallGroups] = useState<Record<string, boolean>>({});
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
  const bank = settings.banking_details || {};

  const vatPercent = toPercent(taxRate);
  const accountType =
    String(bank.account_type || "").match(/^[A-Za-z ]+/)?.[0].trim() || bank.account_type || "";
  const cleanTerms = stripLegacyBanking(termsText);

  return (
    <div
      ref={editRootRef}
      data-pdf-capture-root="estimate"
      className={`estimate-document pdf-page mx-auto w-full text-slate-800 shadow-sm ring-1 ring-slate-200 print:bg-white print:shadow-none print:ring-0 ${
        editing ? "estimate-editing bg-slate-100" : "bg-white"
      }`}
    >

      <div className="p-8 sm:p-10">
        {/* ── Top: logo left, business info right ── */}
        <div className="flex items-start justify-between gap-6">
          <div className="rounded-2xl border border-slate-200 bg-[#1B3A5C] p-3 shadow-sm">
            <img src={logo} alt="Company logo" className="h-16 w-auto object-contain" />
          </div>
          <div className="text-right text-[12px] leading-relaxed text-slate-600">
            <p className="text-[15px] font-bold text-[#1B3A5C]">
              {settings.company_name || "0800-BE-COOL AC Super Service"}
            </p>
            {settings.physical_address
              ? settings.physical_address.split("\n").map((line, i) => <p key={i}>{line}</p>)
              : <p>6 Aviation Crescent, Airport City, Cape Town, 7100</p>}
            <p>0800 23 2665</p>
            <p>info@becool.co.za</p>
            {settings.vat_number && <p>VAT No: {settings.vat_number}</p>}
          </div>
        </div>

        {/* ── Title ── */}
        <h1 className="mt-8 text-[22px] font-bold tracking-tight text-[#1B3A5C]">
          {editing ? "Estimate" : customerName ? `${customerName} — Quote / Proposal` : "Quote / Proposal"}
        </h1>


        {/* ── Meta row ── */}
        <div className="mt-4 grid grid-cols-2 gap-6 border-y border-slate-200 py-6 sm:grid-cols-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Prepared For</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-900">{customerName}</p>
            {customerCompany && <p className="text-[12px] text-slate-600">{customerCompany}</p>}
            {customerAddress && <p className="text-[12px] leading-snug text-slate-600">{customerAddress}</p>}
            {customerEmail && <p className="text-[12px] text-slate-600">{customerEmail}</p>}
            {customerPhone && <p className="text-[12px] text-slate-600">{customerPhone}</p>}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{formatDate(issueDate)}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Valid Until</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">
              {validUntil ? formatDate(validUntil) : "30 days"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Estimate Number</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{estimateNumber}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total (ZAR)</p>
            <p className="mt-1 text-2xl font-bold text-[#1B3A5C]">{formatCurrency(grandTotal)}</p>
          </div>
        </div>

        {/* ── Line items ── */}
        {editing ? (
          <div className="mt-6 space-y-6">
            {editing.areas.map((area) => (
              <section
                key={area.id ?? "unassigned"}
                onFocus={() => editing.onSelectArea?.(area.id)}
                onClick={() => editing.onSelectArea?.(area.id)}
                className="rounded-lg bg-white p-4 ring-1 ring-slate-200 print:rounded-none print:p-0 print:ring-0"
              >
                <div className="flex items-center gap-2 border-b border-slate-300 pb-1">
                  {area.id ? (
                    <AreaNameLabel
                      key={`${area.id}-${area.name}`}
                      name={area.name}
                      autoEdit={editing.focusAreaId === area.id}
                      onRename={(v) => editing.onRenameArea(area.id as string, v)}
                      className="text-[13px] font-semibold uppercase tracking-wide text-[#1B3A5C]"
                    />
                  ) : (
                    <AreaNameLabel
                      key={`default-${area.name}`}
                      name={area.name}
                      isDefault={area.name === "Add items to quote" || undefined}
                      onRename={(v) => editing.onNameDefaultArea?.(v)}
                      className="text-[13px] font-semibold uppercase tracking-wide text-[#1B3A5C]"
                    />
                  )}
                  {area.id && editing.onDeleteArea && (
                    <button
                      type="button"
                      aria-label={`Delete area ${area.name}`}
                      title="Delete this area and its lines"
                      onClick={(e) => {
                        e.stopPropagation();
                        editing.onDeleteArea?.(area.id as string);
                      }}
                      className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-600 shadow-sm hover:bg-red-100 hover:text-red-700 print:hidden"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <table className="estimate-lines mt-2 w-full border-collapse text-[12px]">

                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500 max-sm:portrait:hidden">
                      <th className="py-2 text-left font-semibold">Description</th>
                      <th className="w-24 py-2 text-right font-semibold">Rate</th>
                      <th className="w-16 py-2 text-right font-semibold">Qty</th>
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
                          <tr key={`install-summary-${row.unitId}`} className="estimate-install-summary border-b border-slate-100 bg-slate-50 print:hidden">
                            <td colSpan={5} className="py-1.5">
                              <button
                                type="button"
                                aria-label={open ? "Hide installation materials" : "Show installation materials"}
                                aria-expanded={open}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenInstallGroups((current) => ({ ...current, [row.unitId]: !current[row.unitId] }));
                                }}
                                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-slate-600 hover:bg-slate-100"
                              >
                                {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                <span className="font-medium text-slate-700">Installation materials</span>
                                <span className="text-slate-500">· {row.lines.length} items · {formatCurrency(total)}</span>
                              </button>
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
                                <input
                                  key={`${line.id}-name-${line.displayName ?? ""}`}
                                  defaultValue={line.displayName || line.name}
                                  title={line.displayName ? line.name : undefined}
                                  aria-label="Line name"
                                  onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    const shown = line.displayName || line.name;
                                    if (v && v !== shown) editing.onLineChange(line.id, { item_name: v });
                                  }}
                                  className={`${inputBase} font-medium text-slate-800`}
                                />
                                </div>
                                {line.kitItems && openKits[line.id] && (
                                  <ul data-testid="kit-contents" className="mb-1 ml-7 space-y-0.5 text-[11px] text-slate-500">
                                    {line.kitItems.map((k, idx) => (
                                      <li key={idx} className="flex justify-between gap-2"><span>{k.name}</span>{k.qty && <span className="shrink-0">× {k.qty}</span>}</li>
                                    ))}
                                  </ul>
                                )}
                                <textarea
                                  key={`${line.id}-desc`}
                                  defaultValue={line.description ?? ""}
                                  rows={2}
                                  placeholder="Description (prints on the quote)"
                                  onBlur={(e) => {
                                    const v = e.target.value;
                                    if (v !== (line.description ?? "")) {
                                      editing.onLineChange(line.id, { description: v || null });
                                    }
                                  }}
                                  className={`${inputBase} mt-0.5 resize-y text-[11px] text-slate-500`}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-2 text-right">
                            <input
                              key={`${line.id}-price`}
                              type="number"
                              step="0.01"
                              defaultValue={line.unit_price}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v !== line.unit_price) {
                                  editing.onLineChange(line.id, { unit_price: v });
                                }
                              }}
                              className={`${inputBase} text-right text-slate-600`}
                            />
                            {line.staffNote && (
                              <div data-html2canvas-ignore className="text-[10px] text-slate-400 print:hidden">{line.staffNote}</div>
                            )}
                            {line.isService && !line.unit_price && (
                              <div className="text-[10px] italic text-slate-400 print:hidden">price not set</div>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            {line.kitBundleId && line.kitPerMetre && editing.onKitLengthChange ? (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  key={`${line.id}-len-${line.kitLength ?? 3}`}
                                  type="number"
                                  step="any"
                                  min="0.1"
                                  inputMode="decimal"
                                  defaultValue={line.kitLength ?? 3}
                                  aria-label="Kit length (m)"
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={(e) => {
                                    const saved = line.kitLength ?? 3;
                                    const v = Number(e.target.value);
                                    if (e.target.value.trim() === "" || !Number.isFinite(v) || v < 0.1) { e.target.value = String(saved); return; }
                                    if (v !== saved) editing.onKitLengthChange?.(line.id, v);
                                  }}
                                  className={`${inputBase} text-right text-slate-600`}
                                />
                                <span className="text-[11px] text-slate-500">m</span>
                              </div>
                            ) : (
                            <input
                              key={`${line.id}-qty`}
                              type="number"
                              step={line.perMetre ? "0.1" : "1"}
                              min="0"
                              defaultValue={line.quantity}
                              aria-label={line.perMetre ? "Metres" : "Quantity"}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v !== line.quantity) {
                                  editing.onLineChange(line.id, { quantity: v });
                                }
                              }}
                              className={`${inputBase} text-right text-slate-600`}
                            />
                            )}
                            {line.unitText && !(line.kitBundleId && line.kitPerMetre && editing.onKitLengthChange) && (
                              <div data-testid="qty-unit" className="whitespace-nowrap text-[10px] text-slate-500 print:hidden">{line.unitText}</div>
                            )}
                          </td>
                          <td className="py-2 text-right font-medium text-slate-900">
                            {formatCurrency(lineAmount(line))}
                          </td>
                          <td className="py-2 text-right print:hidden">
                            <div className="flex items-center justify-end gap-1">
                            {(editing.onMoveLine || editing.onDuplicateLine) && editing.areas.some((a) => a.id && a.id !== area.id) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button type="button" aria-label="Line actions" onClick={(e) => e.stopPropagation()}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                  {editing.onMoveLine && <DropdownMenuLabel className="text-xs">Move to…</DropdownMenuLabel>}
                                  {editing.onMoveLine && editing.areas.filter((a) => a.id && a.id !== area.id).map((a) => (
                                    <DropdownMenuItem key={`m-${a.id}`} onSelect={() => editing.onMoveLine?.(line.id, a.id as string)}>{a.name}</DropdownMenuItem>
                                  ))}
                                  {editing.onMoveLine && editing.onDuplicateLine && <DropdownMenuSeparator />}
                                  {editing.onDuplicateLine && <DropdownMenuLabel className="text-xs">Duplicate to…</DropdownMenuLabel>}
                                  {editing.onDuplicateLine && editing.areas.filter((a) => a.id).map((a) => (
                                    <DropdownMenuItem key={`d-${a.id}`} onSelect={() => editing.onDuplicateLine?.(line.id, a.id as string)}>{a.name}{a.id === area.id ? " (this area)" : ""}</DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <button
                              type="button"
                              aria-label="Remove line"
                              title="Remove line"
                              onClick={() => editing.onDeleteLine(line.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-600 shadow-sm hover:bg-red-100 hover:text-red-700"
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

                {/* ── Per-area add bar (staff only, never printed) ── */}
                {editing.renderAddBar && (
                  <div className="pt-2 print:hidden">{editing.renderAddBar(area.id)}</div>
                )}

                {area.lines.length === 0 && (
                  <p className="py-4 text-center text-[11px] text-slate-400 print:hidden">
                    No lines here yet — use the add bar above to build this section.
                  </p>
                )}
              </section>

            ))}

            <button
              type="button"
              onClick={editing.onAddArea}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-3 py-1.5 text-[12px] text-slate-600 hover:border-[#1B3A5C] hover:text-[#1B3A5C] print:hidden"
            >
              <Plus className="h-3.5 w-3.5" /> Add area
            </button>
          </div>

        ) : rollup ? (
          <div className="mt-8 space-y-4">
            {rollup.map((area, idx) => (
              <section key={area.areaId ?? `general-${idx}`} className="border-b border-slate-200 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#1B3A5C]">{area.areaName}</h2>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">Area total</p>
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
                    <p className="text-[11px] italic text-slate-500">Installed incl. piping, materials &amp; labour</p>
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

        {/* ── Totals ── */}
        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-[320px] space-y-2 text-[12px]">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Discount{discountLabel ? ` (${discountLabel})` : ""}</span>
                <span>-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            {editing?.discountControl && <div className="print:hidden">{editing.discountControl}</div>}
            <div className="flex justify-between text-slate-600">
              <span>VAT ({vatPercent}%)</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>
            <div className="flex items-center justify-between border-t-2 border-[#1B3A5C] pt-2 text-[15px] font-bold text-[#1B3A5C]">
              <span>Total (ZAR)</span>
              <span className="text-lg">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-10 space-y-5 border-t border-slate-200 pt-6 text-[11px] leading-relaxed text-slate-600">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terms</p>
            <p className="mt-1 whitespace-pre-line">
              {cleanTerms ||
                `This estimate is valid for 30 days from the date of issue. All prices exclude VAT, which is shown separately at ${vatPercent}%. A ${settings.default_deposit_percentage || 70}% deposit is payable on acceptance; the balance is due within ${settings.default_payment_terms_days || 30} days of completion.`}
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
              <p><span className="text-slate-400">Account Name: </span>{bank.account_name || settings.company_name || "—"}</p>
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
