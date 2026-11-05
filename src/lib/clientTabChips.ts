/** Client record section chips (Johan 5 Nov): weight is display-only, from counts and totals the page already has. */

export type ChipWeight = "quiet" | "mid" | "heavy";

export type ClientTabChip = {
  key: string;
  label: string;
  /** Omit when zero so empty tabs stay quiet. */
  count?: number;
  /** Short money or house cue, e.g. "R82k" or "119 houses". */
  cue?: string;
  weight: ChipWeight;
  /** Outstanding invoice money — the brightest unselected chip. */
  money?: boolean;
};

export type ClientTabInput = {
  quoteCount: number;
  quoteOpenValue: number;
  invoiceCount: number;
  invoiceOutstanding: number;
  jobCount: number;
  siteCount: number;
  showProjects: boolean;
  projectCount?: number;
  houseCount?: number;
};

const BASE =
  "shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 transition-colors";

/** Compact rand for a chip. Full randShort stays on the money tiles. */
export function chipMoney(n: number): string | null {
  if (!(n > 0)) return null;
  const r = Math.round(n);
  if (r >= 1_000_000) {
    const m = r / 1_000_000;
    const text = m >= 10 ? String(Math.round(m)) : (Math.round(m * 10) / 10).toFixed(1).replace(/\.0$/, "");
    return `R${text}m`;
  }
  if (r >= 10_000) return `R${Math.round(r / 1000)}k`;
  return `R${r.toLocaleString("en-ZA").replace(/,/g, " ")}`;
}

export function sumHouseCounts(projects: { project_houses?: { count?: number }[] | null }[]): number {
  return projects.reduce((sum, p) => sum + (Number(p.project_houses?.[0]?.count) || 0), 0);
}

function countChip(key: string, label: string, count: number): ClientTabChip {
  return { key, label, count: count > 0 ? count : undefined, weight: count > 0 ? "mid" : "quiet" };
}

export function clientTabChips(input: ClientTabInput): ClientTabChip[] {
  const quoteMoney = chipMoney(input.quoteOpenValue);
  const invoiceMoney = chipMoney(input.invoiceOutstanding);
  const houses = input.houseCount || 0;
  const projects = input.projectCount || 0;
  const chips: ClientTabChip[] = [
    { key: "activity", label: "Activity", weight: "quiet" },
    {
      key: "quotes",
      label: "Quotes",
      count: input.quoteCount > 0 ? input.quoteCount : undefined,
      cue: quoteMoney || undefined,
      weight: quoteMoney ? "heavy" : input.quoteCount > 0 ? "mid" : "quiet",
    },
    {
      key: "invoices",
      label: "Invoices & Payments",
      count: input.invoiceCount > 0 ? input.invoiceCount : undefined,
      cue: invoiceMoney || undefined,
      weight: invoiceMoney ? "heavy" : input.invoiceCount > 0 ? "mid" : "quiet",
      money: !!invoiceMoney,
    },
    countChip("jobs", "Jobs", input.jobCount),
    countChip("sites", "Sites", input.siteCount),
  ];
  if (input.showProjects) {
    chips.push(
      houses > 0
        ? {
            key: "projects",
            label: "Projects",
            count: projects > 1 ? projects : undefined,
            cue: `${houses} ${houses === 1 ? "house" : "houses"}`,
            weight: "heavy",
          }
        : countChip("projects", "Projects", projects),
    );
  }
  return chips;
}

/**
 * Selected stays the solid Field Lynk blue.
 * The type scale only has 400 and 600, so weight shows as size plus colour:
 * quiet 13px/400, a count 13px/600, money or houses 16px/600 on a solid tint.
 */
export function clientTabChipClass(selected: boolean, chip: { weight: ChipWeight; money?: boolean }): string {
  const size = chip.weight === "heavy" ? "text-base font-semibold" : chip.weight === "mid" ? "text-sm font-semibold" : "text-sm font-normal";
  if (selected) return `${BASE} ${size} border-transparent bg-[#1590D6] text-white shadow-sm`;
  if (chip.weight === "heavy" && chip.money) {
    return `${BASE} ${size} border-[#F97316] bg-[#FFF7ED] text-[#C2410C] shadow-sm dark:border-orange-300/80 dark:bg-orange-500/15 dark:text-orange-100`;
  }
  if (chip.weight === "heavy") {
    return `${BASE} ${size} border-[#1590D6] bg-sky-100 text-[#0F2A44] shadow-sm dark:border-sky-300 dark:bg-sky-400/20 dark:text-sky-50`;
  }
  if (chip.weight === "mid") {
    return `${BASE} ${size} border-[#1590D6]/50 bg-sky-50 text-foreground hover:border-[#1590D6] dark:border-sky-400/40 dark:bg-sky-400/10`;
  }
  return `${BASE} ${size} border-border bg-card text-muted-foreground hover:border-[#1590D6] hover:text-foreground`;
}
