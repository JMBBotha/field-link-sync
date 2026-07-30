import { ProposalSection, formatZAR, sectionSubtotal, proposalTotal } from "@/types/visualProposal";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PenLine, CheckCircle2 } from "lucide-react";

/** Minimal markdown renderer (headings, bold, italic, bullets). */
const renderMarkdown = (md: string) => {
  if (!md) return "";
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-5 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, '<li class="ml-5 list-disc">$1</li>')
    .replace(/\n/g, "<br />");
  html = html.replace(
    /(<li[^>]*>.*?<\/li>(<br \/>)?)+/g,
    (m) => `<ul class="my-2 space-y-1">${m.replace(/<br \/>/g, "")}</ul>`,
  );
  return html;
};

interface Props {
  title: string;
  clientName?: string;
  sections: ProposalSection[];
  /** Client-facing mode enables the Accept & Sign button. */
  interactive?: boolean;
  onAccept?: (sectionId: string, signerName: string) => void;
  onSignerNameChange?: (sectionId: string, name: string) => void;
}

const VisualProposalPreview = ({
  title,
  clientName,
  sections,
  interactive,
  onAccept,
  onSignerNameChange,
}: Props) => {
  const total = proposalTotal(sections);

  return (
    <div className="mx-auto w-full max-w-3xl bg-white text-slate-800 shadow-sm">
      {sections.length === 0 && (
        <div className="p-12 text-center text-sm text-slate-400">
          Add a section to start building your proposal.
        </div>
      )}

      {sections.map((s) => {
        if (s.type === "cover") {
          return (
            <div key={s.id} className="bg-[#1B3A5C] p-10 text-center text-white">
              {s.imageUrl && (
                <img
                  src={s.imageUrl}
                  alt={s.title || "Proposal cover"}
                  className="mx-auto mb-6 max-h-52 w-full rounded-lg object-cover"
                />
              )}
              <h1 className="text-3xl font-bold">{s.title || title}</h1>
              {s.subtitle && <p className="mt-2 text-white/70">{s.subtitle}</p>}
              {clientName && (
                <p className="mt-6 text-sm text-white/80">
                  Prepared for <strong>{clientName}</strong>
                </p>
              )}
              <p className="mt-1 text-xs text-white/60">
                {new Date().toLocaleDateString("en-ZA", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          );
        }

        if (s.type === "text") {
          return (
            <div key={s.id} className="p-8">
              {s.title && <h2 className="mb-2 text-lg font-bold text-[#1B3A5C]">{s.title}</h2>}
              <div
                className="text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body || "") }}
              />
            </div>
          );
        }

        if (s.type === "image") {
          return (
            <div key={s.id} className="p-8 pt-0">
              {s.title && <h2 className="mb-2 text-lg font-bold text-[#1B3A5C]">{s.title}</h2>}
              {s.imageUrl ? (
                <img
                  src={s.imageUrl}
                  alt={s.caption || s.title || "Proposal image"}
                  className="w-full rounded-lg object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-xs text-slate-400">
                  No image selected
                </div>
              )}
              {s.caption && (
                <p className="mt-2 text-center text-xs italic text-slate-500">{s.caption}</p>
              )}
            </div>
          );
        }

        if (s.type === "pricing") {
          const sub = sectionSubtotal(s);
          return (
            <div key={s.id} className="bg-slate-50 p-8">
              <h2 className="mb-3 text-lg font-bold text-[#1B3A5C]">{s.title || "Pricing"}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2">Description</th>
                    <th className="py-2 text-right">Rate</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.items || []).map((i) => (
                    <tr key={i.id} className="border-b border-slate-200/70">
                      <td className="py-2 pr-2">{i.description || "—"}</td>
                      <td className="py-2 text-right">{formatZAR(Number(i.rate) || 0)}</td>
                      <td className="py-2 text-right">{i.quantity}</td>
                      <td className="py-2 text-right font-semibold">
                        {formatZAR((Number(i.quantity) || 0) * (Number(i.rate) || 0))}
                      </td>
                    </tr>
                  ))}
                  {(s.items || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-xs text-slate-400">
                        No items yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="mt-3 flex justify-end">
                <div className="w-56">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-bold">{formatZAR(sub)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // signature
        return (
          <div key={s.id} className="p-8">
            <h2 className="mb-2 text-lg font-bold text-[#1B3A5C]">{s.title || "Acceptance"}</h2>
            <Separator className="mb-4" />
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-slate-500">Client name</p>
                {interactive ? (
                  <input
                    className="mt-1 w-full max-w-xs rounded border px-2 py-1 text-sm"
                    placeholder="Type your full name"
                    value={s.signerName || ""}
                    onChange={(e) => onSignerNameChange?.(s.id, e.target.value)}
                    disabled={!!s.signedAt}
                  />
                ) : (
                  <p className="mt-1 border-b border-slate-300 pb-1 text-sm">
                    {s.signerName || "\u00A0"}
                  </p>
                )}
                {s.signedAt && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Accepted {new Date(s.signedAt).toLocaleString("en-ZA")}
                  </p>
                )}
              </div>
              <Button
                type="button"
                className="bg-[#2FAC66] hover:bg-[#2FAC66]/90"
                disabled={!interactive || !!s.signedAt || !(s.signerName || "").trim()}
                onClick={() => onAccept?.(s.id, s.signerName || "")}
              >
                <PenLine className="mr-2 h-4 w-4" />
                {s.signedAt ? "Accepted" : "Accept & Sign"}
              </Button>
            </div>
          </div>
        );
      })}

      {total > 0 && (
        <div className="flex items-center justify-between border-t bg-[#1B3A5C]/5 px-8 py-4">
          <span className="text-sm font-semibold text-[#1B3A5C]">Proposal total</span>
          <span className="text-xl font-bold text-[#1B3A5C]">{formatZAR(total)}</span>
        </div>
      )}
    </div>
  );
};

export default VisualProposalPreview;
