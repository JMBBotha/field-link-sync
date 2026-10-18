/**
 * Agreement template text format (Johan 18 Oct 2026): each section body is plain text,
 * one block per line:
 *   "2.1 Text"        numbered clause (number shown in blue)
 *   "- Text"          bullet (a bullet may itself start with a clause number)
 *   "| a | b |"       table row (first row = header; "|---|" rows are ignored)
 *   anything else     paragraph
 * Inline: **bold**, {{company.name}} style fields filled on output.
 * Pure functions only, so the editor preview, the PDF and the tests share one parser.
 */

export type DocKind = "contract" | "sla";
export type SectionKind = "text" | "signatures" | "units";

export interface TemplateSection {
  doc_kind: DocKind;
  position: number;
  kind: SectionKind;
  heading: string;
  body: string;
}

export type Block =
  | { type: "clause"; num: string; text: string }
  | { type: "bullet"; num?: string; text: string }
  | { type: "paragraph"; text: string }
  | { type: "table"; header: string[]; rows: string[][] };

const CLAUSE_RE = /^(\*\*)?(\d+(?:\.\d+)+\.?|\d+\.)(\*\*)?\s+(.*)$/;

function splitClause(line: string): { num: string; text: string } | null {
  const m = line.match(CLAUSE_RE);
  if (!m) return null;
  const num = m[2].replace(/\.$/, "");
  // "**3.1 Heading** rest" -> keep the bold on the remaining heading words
  let text = m[4];
  if (m[1] && !m[3]) text = `**${text}`;
  return { num, text };
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSeparator = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line.trim());

export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  let table: { header: string[]; rows: string[][] } | null = null;
  for (const raw of (body || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("|")) {
      if (isSeparator(line)) continue;
      if (!table) { table = { header: cells(line), rows: [] }; blocks.push({ type: "table", ...table }); }
      else table.rows.push(cells(line));
      continue;
    }
    table = null;
    if (!line) continue;
    if (/^[-•*]\s+/.test(line) && !line.startsWith("**")) {
      const rest = line.replace(/^[-•*]\s+/, "");
      const c = splitClause(rest);
      blocks.push(c ? { type: "bullet", num: c.num, text: c.text } : { type: "bullet", text: rest });
      continue;
    }
    const c = splitClause(line);
    if (c) blocks.push({ type: "clause", ...c });
    else blocks.push({ type: "paragraph", text: line });
  }
  return blocks;
}

export interface InlineRun { text: string; bold: boolean; field?: boolean }

/** Splits "**bold** text" into runs; unmatched ** are kept as text. Single *italics* markers are dropped. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const parts = (text || "").split(/(\*\*[^*]+\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    if (/^\*\*[^*]+\*\*$/.test(p)) runs.push({ text: p.slice(2, -2), bold: true });
    else runs.push({ text: p.replace(/(^|\s)\*(?!\s)([^*]+?)\*(?=\s|[.,;:]|$)/g, "$1$2"), bold: false });
  }
  return runs;
}

export const stripInline = (text: string) => parseInline(text).map((r) => r.text).join("");

export const FIELD_RE = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/gi;

export type FieldValues = Record<string, string | null | undefined>;

/** Fills {{fields}}. Missing values become a visible blank "[field]" so nothing is invented. */
export function fillFields(text: string, values: FieldValues): string {
  return (text || "").replace(FIELD_RE, (_m, key: string) => {
    const v = values[key.toLowerCase()];
    return v != null && String(v).trim() !== "" ? String(v) : `[${key}]`;
  });
}

export function listFields(sections: Pick<TemplateSection, "heading" | "body">[]): string[] {
  const set = new Set<string>();
  for (const s of sections) for (const m of `${s.heading}\n${s.body}`.matchAll(FIELD_RE)) set.add(m[1].toLowerCase());
  return [...set].sort();
}

export const FIELD_HELP: { key: string; label: string }[] = [
  { key: "company.name", label: "Company legal name" },
  { key: "company.short", label: "Short company name (e.g. Massair)" },
  { key: "company.vat", label: "Company VAT number" },
  { key: "company.address", label: "Company address" },
  { key: "company.phone", label: "Company phone" },
  { key: "company.whatsapp", label: "Company WhatsApp" },
  { key: "company.email", label: "Company email" },
  { key: "company.web", label: "Company website" },
  { key: "company.banking", label: "Company banking line" },
  { key: "company.signatory", label: "Authorised signatory" },
  { key: "client.name", label: "Client name (contracts)" },
  { key: "client.vat", label: "Client VAT number (contracts)" },
  { key: "contract.number", label: "Contract number (contracts)" },
  { key: "contract.start_date", label: "Start date (contracts)" },
  { key: "contract.frequency", label: "Service frequency (contracts)" },
];

/** Sorted, renumbered sections for one document. */
export function docSections(all: TemplateSection[], doc: DocKind): TemplateSection[] {
  return all.filter((s) => s.doc_kind === doc).sort((a, b) => a.position - b.position).map((s, i) => ({ ...s, position: i + 1 }));
}

/** Moves a section up/down within its document and renumbers positions. */
export function moveSection(all: TemplateSection[], doc: DocKind, index: number, delta: -1 | 1): TemplateSection[] {
  const list = docSections(all, doc);
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return all;
  const [s] = list.splice(index, 1);
  list.splice(to, 0, s);
  const others = all.filter((x) => x.doc_kind !== doc);
  return [...others, ...list.map((x, i) => ({ ...x, position: i + 1 }))];
}

export function removeSection(all: TemplateSection[], doc: DocKind, index: number): TemplateSection[] {
  const list = docSections(all, doc);
  list.splice(index, 1);
  return [...all.filter((x) => x.doc_kind !== doc), ...list.map((x, i) => ({ ...x, position: i + 1 }))];
}

export function addSection(all: TemplateSection[], doc: DocKind, afterIndex?: number): TemplateSection[] {
  const list = docSections(all, doc);
  const at = afterIndex == null ? list.length : Math.min(afterIndex + 1, list.length);
  list.splice(at, 0, { doc_kind: doc, position: 0, kind: "text", heading: "New section", body: "" });
  return [...all.filter((x) => x.doc_kind !== doc), ...list.map((x, i) => ({ ...x, position: i + 1 }))];
}

/** Payload for save_agreement_template (contract first, then SLA). */
export function toSavePayload(all: TemplateSection[]) {
  return (["contract", "sla"] as DocKind[]).flatMap((d) =>
    docSections(all, d).map((s) => ({ doc_kind: s.doc_kind, position: s.position, kind: s.kind, heading: s.heading.trim(), body: s.body })));
}
