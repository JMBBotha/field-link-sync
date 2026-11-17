/** Phone list for the admin Home money card.
 *  Amounts are the figures already on the yard model. Nothing here is recomputed
 *  except the split of next-7 and next-30 into overdue, the next 7 days, and the
 *  rest of the 30 days. Those three add back to the existing totals.
 *  Projected stays cash plus money due in 30 days, including overdue.
 *  Liabilities are not subtracted. */
import { fmtDay } from "@/lib/balanceDue";
import { fmtHomeRand } from "@/lib/adminHomeCount";
import type { ExpectedRow } from "@/lib/expectedMoney";
import type { LiabilityLineView } from "@/lib/liabilityLines";
import type { YardHomeModel, YardMoneyLine, YardMoneyTile } from "@/lib/yardView";

export interface HomeMoneyLine {
  id: string;
  label: string;
  amountLabel: string;
  dateLabel: string;
  href: string;
}

export type HomeMoneyPanel =
  | { kind: "cash" }
  | { kind: "deposits" }
  | { kind: "finals" }
  | { kind: "window"; depositIds: string[]; finalIds: string[]; extras: HomeMoneyLine[] }
  | { kind: "liabilities"; when: "all" | "overdue" | "upcoming" }
  | { kind: "projected"; depositIds: string[]; finalIds: string[]; extras: HomeMoneyLine[] }
  | { kind: "leads" }
  | { kind: "jobs" };

export interface HomeMoneyFigure {
  key: string;
  label: string;
  heading?: boolean;
  /** Underlying amount. Null when the row is a count, a blank, or a heading. */
  amount: number | null;
  amountLabel: string;
  amountLines?: string[];
  explain: string;
  info: string;
  stale?: string | null;
  href: string;
  action: string;
  testId: string;
  dateTestId?: string;
  tone?: "bar";
  panel: HomeMoneyPanel;
  lines: HomeMoneyLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function bankShort(label: string): string {
  const text = label.trim() || "the bank";
  return /^fnb\b/i.test(text) ? "FNB" : text;
}

function poster(source: string | null | undefined): string {
  return source === "walda" ? "posted by WALDA" : "typed in by a person";
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] || "the bank";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function cashExplain(tile: YardMoneyTile): string {
  if (!tile.amountLabel) {
    if (tile.dateLine === "Loading…") return "Loading the bank balance.";
    if (tile.dateLine === "Couldn't load") return "The bank balance could not be loaded.";
    return "No bank balance entered yet.";
  }
  const lines = tile.lines;
  if (!lines.length) return "Money in the bank.";
  const names = lines.map((line) => bankShort(line.label));
  const day = tile.dateLine.startsWith("As at ") ? tile.dateLine.slice("As at ".length) : null;
  const who = lines.map((line) => poster(line.source));
  const same = who.every((item) => item === who[0]);
  const place = `Money in the bank (${joinNames(names)})`;
  const when = day ? ` as at ${day}` : "";
  if (same) return `${place}${when}, ${who[0]}.`;
  const each = lines.map((line) => `${bankShort(line.label)} ${poster(line.source)}`).join(". ");
  return `${place}${when}. ${each}.`;
}

function counted(rows: ExpectedRow[]): string {
  const invoices = new Set<string>();
  let quotes = 0;
  let added = 0;
  for (const row of rows) {
    const inv = /^inv:([^:]+):/.exec(row.id);
    if (inv) {
      invoices.add(inv[1]);
      continue;
    }
    if (row.id.startsWith("quote:")) quotes += 1;
    else added += 1;
  }
  const parts: string[] = [];
  if (invoices.size) parts.push(`${invoices.size} invoice${invoices.size === 1 ? "" : "s"}`);
  if (quotes) parts.push(`${quotes} quote${quotes === 1 ? "" : "s"} not invoiced yet`);
  if (added) parts.push(`${added} added by hand`);
  return parts.join(" and ");
}

function focusOf(rows: ExpectedRow[]): { depositIds: string[]; finalIds: string[]; extras: HomeMoneyLine[] } {
  const depositIds: string[] = [];
  const finalIds: string[] = [];
  const extras: HomeMoneyLine[] = [];
  for (const row of rows) {
    const inv = /^inv:([^:]+):(deposit|final)$/.exec(row.id);
    if (inv) {
      (inv[2] === "deposit" ? depositIds : finalIds).push(inv[1]);
      continue;
    }
    extras.push({
      id: row.id,
      label: row.label,
      amountLabel: row.amountLabel,
      dateLabel: row.dateLabel,
      href: row.href || "/admin/cash-health",
    });
  }
  return { depositIds, finalIds, extras };
}

function rangeWords(days: string[]): string {
  const sorted = [...days].filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
  if (!sorted.length) return "";
  const first = fmtDay(sorted[0]);
  const last = fmtDay(sorted[sorted.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

function shownWhen(dateLine: string, lines: YardMoneyLine[], today: string): string {
  const days = lines.map((line) => (line.iso || "").slice(0, 10)).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  if (!days.length) return dateLine;
  const sorted = [...days].sort();
  if (sorted[sorted.length - 1] < today) {
    const range = rangeWords(sorted);
    const completion = /due on completion/i.test(dateLine) ? " Due on completion is still in this figure." : "";
    return `Already overdue, ${range}.${completion}`;
  }
  if (sorted[0] < today) return `${dateLine}. Some of these dates are already past`;
  return dateLine;
}

function invoiceSentence(kind: "deposit" | "final", tile: YardMoneyTile, today: string): string {
  const noun = kind === "deposit" ? "Deposit" : "Final";
  if (!tile.lines.length || tile.dateLine === "Nothing due") {
    return kind === "deposit" ? "No deposit balances still to collect." : "No final balances still to collect.";
  }
  const n = tile.lines.length;
  const when = shownWhen(tile.dateLine, tile.lines, today);
  return `${noun} balances still to collect. ${n} invoice${n === 1 ? "" : "s"}. ${when}.`.replace(/\.\./g, ".");
}

function liabilityLines(model: YardHomeModel): LiabilityLineView[] {
  return model.liabilities.liabilities?.groups.flatMap((group) => group.rows.flatMap((row) => row.lines)) || [];
}

function leadLines(model: YardHomeModel): HomeMoneyLine[] {
  return model.openLeadRows.map((row) => ({
    id: row.id,
    label: [row.customer, row.stage].filter(Boolean).join(" · "),
    amountLabel: row.amountLabel || "",
    dateLabel: row.typeLabel || "",
    href: row.href,
  }));
}

function jobLines(model: YardHomeModel): HomeMoneyLine[] {
  return [
    { id: "today", label: "Today", amountLabel: String(model.jobs.today), dateLabel: "", href: model.jobs.todayHref },
    { id: "week", label: "This week", amountLabel: String(model.jobs.week), dateLabel: "Monday to Sunday", href: model.jobs.weekHref },
    { id: "month", label: "This month", amountLabel: String(model.jobs.month), dateLabel: "", href: model.jobs.monthHref },
  ];
}

export function homeMoneyFigures(model: YardHomeModel): HomeMoneyFigure[] {
  const today = model.today;
  const end7 = addDays(today, 6);
  const after7 = addDays(today, 7);
  const end30 = addDays(today, 29);
  const rows = model.expected.rows;
  const overdueRows = rows.filter((row) => row.overdue);
  const due7Rows = rows.filter((row) => row.in7 && !row.overdue);
  const due30Rows = rows.filter((row) => row.in30 && !row.in7);
  const outside = rows.filter((row) => !row.in30);
  const sum = (list: ExpectedRow[]) => round2(list.reduce((total, row) => total + row.amount, 0));
  const overdue = sum(overdueRows);
  const due7 = sum(due7Rows);
  const due30 = sum(due30Rows);
  const window = (key: string, label: string, amount: number, list: ExpectedRow[], explain: string, info: string, testId: string): HomeMoneyFigure => {
    const focus = focusOf(list);
    return {
      key,
      label,
      amount,
      amountLabel: fmtHomeRand(amount),
      explain,
      info,
      href: "/admin/cash-health",
      action: "Open the list",
      testId,
      panel: { kind: "window", ...focus },
      lines: [],
    };
  };
  const overduePhrase = counted(overdueRows);
  const due7Phrase = counted(due7Rows);
  const due30Phrase = counted(due30Rows);
  const outsideNote = outside.length
    ? ` ${outside.length} amount${outside.length === 1 ? " has" : "s have"} no date or ${outside.length === 1 ? "falls" : "fall"} after ${fmtDay(end30)}, so ${outside.length === 1 ? "it is" : "they are"} left out. ${outside.length === 1 ? "It still shows" : "They still show"} under Expected deposits or Expected finals.`
    : "";

  const cash: HomeMoneyFigure = {
    key: "cash",
    label: "Cash on hand",
    amount: model.expected.cash,
    amountLabel: model.cash.amountLabel ?? "—",
    explain: cashExplain(model.cash),
    info: "Latest balance on Cash-flow health. An account with no balance is left out and is not counted as zero.",
    stale: model.cash.staleHint,
    href: model.cash.href,
    action: "Open the list",
    testId: "money-cash",
    dateTestId: "money-date-cash",
    panel: { kind: "cash" },
    lines: model.cash.lines.map((line) => ({ id: line.id, label: line.label, amountLabel: line.amountLabel, dateLabel: line.dateLabel, href: line.href })),
  };

  const picture = model.liabilities.liabilities;
  const ready = model.liabilities.amountLabel != null && !!picture;
  const fullLabel = model.liabilities.amountLabel ?? "—";
  const liabilityInfo = `Units and materials still to buy for jobs with the deposit in. Supplier cost incl. VAT. The full liabilities figure is ${fullLabel}.`;
  let liabilityRows: HomeMoneyFigure[];
  if (!ready || (picture?.total || 0) <= 0) {
    liabilityRows = [{
      key: "liabilities",
      label: "Liabilities",
      amount: picture?.total ?? null,
      amountLabel: fullLabel,
      explain: model.liabilities.dateLine === "Nothing still to buy" ? "Nothing still to buy." : model.liabilities.dateLine,
      info: "Units and materials still to buy for jobs with the deposit in.",
      href: model.liabilities.href,
      action: "Open the list",
      testId: "money-liabilities",
      dateTestId: "money-date-liabilities",
      panel: { kind: "liabilities", when: "all" },
      lines: [],
    }];
  } else {
    const lines = liabilityLines(model);
    const past = lines.filter((line) => line.payDate && line.payDate < today);
    const later = lines.filter((line) => !line.payDate || line.payDate >= today);
    const pastAmount = round2(past.reduce((total, line) => total + line.amount, 0));
    const laterAmount = round2(later.reduce((total, line) => total + line.amount, 0));
    const pastDays = rangeWords(past.map((line) => line.payDate || ""));
    const laterDays = rangeWords(later.map((line) => line.payDate || "").filter((day) => day >= today));
    const undated = later.filter((line) => !line.payDate).length;
    const laterExplain = later.length === 0
      ? "Nothing to pay from today onward."
      : laterDays
        ? `Pay dates from today: ${laterDays}.${undated ? ` Includes ${undated} with no pay date.` : ""}`
        : undated === 1 ? "1 line has no pay date." : `${undated} lines have no pay date.`;
    liabilityRows = [
      {
        key: "liabilities-overdue",
        label: "Liabilities overdue",
        amount: pastAmount,
        amountLabel: fmtHomeRand(pastAmount),
        explain: past.length ? `Pay dates already past: ${pastDays}.` : "No pay dates already past.",
        info: liabilityInfo,
        href: model.liabilities.href,
        action: "Open the list",
        testId: "money-liabilities",
        panel: { kind: "liabilities", when: "overdue" },
        lines: [],
      },
      {
        key: "liabilities-upcoming",
        label: "Liabilities coming up",
        amount: laterAmount,
        amountLabel: fmtHomeRand(laterAmount),
        explain: laterExplain,
        info: "The rest of the liabilities figure. A line with no pay date is counted here, not as overdue.",
        href: model.liabilities.href,
        action: "Open the list",
        testId: "money-liabilities-upcoming",
        panel: { kind: "liabilities", when: "upcoming" },
        lines: [],
      },
    ];
  }

  const in30 = rows.filter((row) => row.in30);
  const projectedFocus = focusOf(in30);
  const projectedBlank = model.expected.projected == null;

  const figures: HomeMoneyFigure[] = [
    cash,
    { key: "heading-in", label: "Money coming in", heading: true, amount: null, amountLabel: "", explain: "", info: "", href: "", action: "", testId: "", panel: { kind: "cash" }, lines: [] },
    window(
      "overdue",
      "Overdue now",
      overdue,
      overdueRows,
      overduePhrase ? `${overduePhrase} already past the expected date.` : "No invoices past the expected date.",
      "Not included in the next 7 days or the rest of the 30 days. Projected still adds it to cash.",
      "money-overdue",
    ),
    window(
      "due7",
      "Due next 7 days",
      due7,
      due7Rows,
      due7Phrase ? `${due7Phrase} due from today to ${fmtDay(end7)}.` : `No invoices due from today to ${fmtDay(end7)}.`,
      "Overdue invoices are the row above, not in this amount.",
      "money-due-7",
    ),
    window(
      "due30",
      "Due next 30 days",
      due30,
      due30Rows,
      due30Phrase ? `${due30Phrase} due from ${fmtDay(after7)} to ${fmtDay(end30)}.` : `No invoices due from ${fmtDay(after7)} to ${fmtDay(end30)}.`,
      "This is the rest of the 30 days, after the next 7. Add the three rows for the 30-day total used in Projected.",
      "money-due-30",
    ),
    {
      key: "deposits",
      label: "Expected deposits",
      amount: null,
      amountLabel: model.deposits.amountLabel ?? "—",
      explain: invoiceSentence("deposit", model.deposits, today),
      info: "Deposit invoices with a balance still owing, incl. VAT. Drafts that have not been emailed are in Waiting to send.",
      href: model.deposits.href,
      action: "Open the list",
      testId: "money-deposits",
      dateTestId: "money-date-deposits",
      panel: { kind: "deposits" },
      lines: [],
    },
    {
      key: "finals",
      label: "Expected finals",
      amount: null,
      amountLabel: model.finals.amountLabel ?? "—",
      explain: invoiceSentence("final", model.finals, today),
      info: "Unpaid invoices that are not deposits, after payments and credit notes, incl. VAT. Includes overdue finals.",
      href: model.finals.href,
      action: "Open the list",
      testId: "money-finals",
      dateTestId: "money-date-finals",
      panel: { kind: "finals" },
      lines: [],
    },
    ...liabilityRows,
    {
      key: "projected",
      label: "Projected in 30 days",
      amount: model.expected.projected,
      amountLabel: model.expected.projectedLabel,
      explain: projectedBlank
        ? "Cash on hand + money due in 30 days, including overdue. Enter the bank balance before this can be added up. Liabilities are not subtracted."
        : "Cash on hand + money due in 30 days, including overdue. Liabilities are not subtracted.",
      info: `Money due in 30 days is overdue plus the next 7 days plus the rest of the 30 days.${outsideNote}`,
      href: "/admin/cash-health",
      action: "Open the list",
      testId: "money-projected",
      tone: "bar",
      panel: { kind: "projected", ...projectedFocus },
      lines: [],
    },
    {
      key: "leads",
      label: "Open leads",
      amount: model.openLeads.count,
      amountLabel: String(model.openLeads.count),
      explain: "Not booked yet.",
      info: "New leads, quoting, waiting on the customer, and accepted quotes with no job yet. Invoiced, booked, lost and service work stay off this list.",
      href: model.openLeads.href,
      action: "Open the list",
      testId: "money-open-leads",
      panel: { kind: "leads" },
      lines: leadLines(model),
    },
    {
      key: "jobs",
      label: "Jobs",
      amount: null,
      amountLabel: "",
      amountLines: [`${model.jobs.today} today`, `${model.jobs.week} this week`, `${model.jobs.month} this month`],
      explain: "Booked work by its date.",
      info: "Today, this week (Monday to Sunday) and this month. The date is the schedule, otherwise when it started, finished or was created.",
      href: model.jobs.monthHref,
      action: "Open the schedule",
      testId: "money-jobs",
      panel: { kind: "jobs" },
      lines: jobLines(model),
    },
  ];
  return figures;
}
