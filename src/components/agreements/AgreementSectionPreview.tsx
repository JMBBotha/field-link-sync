import { fillFields, parseBody, parseInline, type FieldValues, type TemplateSection } from "@/lib/agreementTemplates/markup";

/** On-screen preview of one template section, same look as the quote terms page (blue chip + uppercase blue heading). */
const Inline = ({ text, fields }: { text: string; fields?: FieldValues }) => (
  <>
    {parseInline(fields ? fillFields(text, fields) : text).map((r, i) => {
      const parts = r.text.split(/(\{\{[^}]+\}\}|\[[a-z_.]+\])/gi);
      const inner = parts.map((p, j) => /^(\{\{[^}]+\}\}|\[[a-z_.]+\])$/i.test(p)
        ? <span key={j} className="rounded bg-orange-100 px-0.5 text-orange-800">{p}</span> : p);
      return r.bold ? <b key={i} className="text-ink">{inner}</b> : <span key={i}>{inner}</span>;
    })}
  </>
);

export default function AgreementSectionPreview({ section, chip, fields }: { section: TemplateSection; chip: string; fields?: FieldValues }) {
  const blocks = parseBody(section.body);
  return (
    <div className="break-inside-avoid" data-testid="agreement-section-preview">
      <div className="flex items-center gap-2 border-b-2 border-[#F7941D] pb-1">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1AA7EC] text-xs font-bold text-white">{chip}</span>
        <h4 className="text-xs font-bold uppercase tracking-wide text-[#0B4FA8]"><Inline text={section.heading || "Section"} fields={fields} /></h4>
      </div>
      <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink">
        {blocks.map((b, i) => {
          if (b.type === "table") return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-xs">
                <thead><tr>{b.header.map((h, j) => <th key={j} className="border-b-2 border-[#1AA7EC] px-2 py-1 text-left font-bold uppercase tracking-wide text-[#0B4FA8]"><Inline text={h} fields={fields} /></th>)}</tr></thead>
                <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border-b border-slate-200 px-2 py-1 align-top"><Inline text={c} fields={fields} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
          if (b.type === "clause" || (b.type === "bullet" && b.num)) return (
            <div key={i} className={`flex gap-2 ${b.type === "bullet" ? "pl-3" : ""}`}><span className="min-w-[2.2rem] font-bold text-[#1AA7EC]">{b.num}</span><div><Inline text={b.text} fields={fields} /></div></div>
          );
          if (b.type === "bullet") return <div key={i} className="flex gap-2 pl-1"><span className="font-bold text-[#1AA7EC]">•</span><div><Inline text={b.text} fields={fields} /></div></div>;
          return <p key={i}><Inline text={b.text} fields={fields} /></p>;
        })}
        {section.kind === "signatures" && <p className="text-xs italic text-ink-muted">Signature boxes for both parties are added here on the PDF.</p>}
        {section.kind === "units" && <p className="text-xs italic text-ink-muted">The covered-units register (location, type, model, serial, size, install date) is added here on the PDF.</p>}
      </div>
    </div>
  );
}
