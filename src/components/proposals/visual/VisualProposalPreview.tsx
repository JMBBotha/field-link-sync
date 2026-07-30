import {
  ProposalSection,
  ProposalStyle,
  DEFAULT_STYLE,
  formatZAR,
  sectionSubtotal,
  sectionVat,
  proposalSubtotal,
  proposalVat,
  proposalTotal,
} from "@/types/visualProposal";
import { Button } from "@/components/ui/button";
import { PenLine, CheckCircle2, FileText } from "lucide-react";

interface Props {
  title: string;
  clientName?: string;
  proposalNumber?: string;
  proposalDate?: string;
  companyName?: string;
  companyLogo?: string | null;
  sections: ProposalSection[];
  style?: ProposalStyle;
  requireSignature?: boolean;
  /** Client-facing mode enables the Accept & Sign button. */
  interactive?: boolean;
  signerName?: string;
  signedAt?: string | null;
  onAccept?: (signerName: string) => void;
  onSignerNameChange?: (name: string) => void;
}

const VisualProposalPreview = ({
  title,
  clientName,
  proposalNumber,
  proposalDate,
  companyName,
  companyLogo,
  sections,
  style = DEFAULT_STYLE,
  requireSignature = true,
  interactive,
  signerName,
  signedAt,
  onAccept,
  onSignerNameChange,
}: Props) => {
  const accent = style.themeColor || DEFAULT_STYLE.themeColor;
  const sub = proposalSubtotal(sections);
  const vat = proposalVat(sections);
  const total = proposalTotal(sections);
  const dateLabel = new Date(proposalDate || Date.now()).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      className="mx-auto w-full max-w-3xl bg-white text-slate-800 shadow-sm"
      style={{ fontFamily: style.font || DEFAULT_STYLE.font }}
    >
      {/* Header */}
      {style.template === "modern" ? (
        <div className="relative">
          {style.heroImage ? (
            <img
              src={style.heroImage}
              alt="Proposal header"
              className="h-48 w-full object-cover"
            />
          ) : (
            <div className="h-32 w-full" style={{ backgroundColor: accent }} />
          )}
          <div className="p-8">
            <h1 className="text-3xl font-bold" style={{ color: accent }}>
              {title || "Proposal"}
            </h1>
            <HeaderMeta
              clientName={clientName}
              companyName={companyName}
              proposalNumber={proposalNumber}
              dateLabel={dateLabel}
            />
          </div>
        </div>
      ) : style.template === "classic" ? (
        <div className="border-b-4 p-8 text-center" style={{ borderColor: accent }}>
          {companyLogo && (
            <img src={companyLogo} alt={companyName || "Company"} className="mx-auto mb-4 h-14 object-contain" />
          )}
          <h1 className="text-2xl font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
            {title || "Proposal"}
          </h1>
          <HeaderMeta
            centered
            clientName={clientName}
            companyName={companyName}
            proposalNumber={proposalNumber}
            dateLabel={dateLabel}
          />
        </div>
      ) : (
        <div className="flex items-start justify-between gap-6 border-b p-8">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: accent }}>
              {title || "Proposal"}
            </h1>
            <HeaderMeta
              clientName={clientName}
              companyName={companyName}
              proposalNumber={proposalNumber}
              dateLabel={dateLabel}
            />
          </div>
          {companyLogo && (
            <img src={companyLogo} alt={companyName || "Company"} className="h-12 object-contain" />
          )}
        </div>
      )}

      {sections.length === 0 && (
        <div className="p-12 text-center text-sm text-slate-400">
          Add a section to start building your proposal.
        </div>
      )}

      {sections.map((s) => {
        if (s.type === "richtext") {
          return (
            <div key={s.id} className="px-8 py-6">
              {s.title && (
                <h2 className="mb-2 text-lg font-bold" style={{ color: accent }}>
                  {s.title}
                </h2>
              )}
              <div
                className="proposal-rte text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: s.html || "" }}
              />
            </div>
          );
        }

        if (s.type === "pricing") {
          const lineSub = sectionSubtotal(s);
          const lineVat = sectionVat(s);
          const discount = Number(s.discount) || 0;
          return (
            <div key={s.id} className="px-8 py-6">
              <h2 className="mb-3 text-lg font-bold" style={{ color: accent }}>
                {s.title || "Pricing"}
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs uppercase tracking-wide text-white"
                    style={{ backgroundColor: accent }}
                  >
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.items || []).map((i) => (
                    <tr key={i.id} className="border-b border-slate-200/70 align-top">
                      <td className="px-3 py-2">
                        <p>{i.description || "—"}</p>
                        {i.detail && (
                          <p className="whitespace-pre-line text-xs text-slate-500">{i.detail}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{formatZAR(Number(i.rate) || 0)}</td>
                      <td className="px-3 py-2 text-right">{i.quantity}</td>
                      <td className="px-3 py-2 text-right font-semibold">
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
                <div className="w-60 space-y-1 text-sm">
                  <SummaryRow label="Subtotal" value={formatZAR(lineSub)} />
                  {discount > 0 && (
                    <SummaryRow label="Discount" value={`- ${formatZAR(discount)}`} />
                  )}
                  <SummaryRow label="VAT (15%)" value={formatZAR(lineVat)} />
                  <div className="flex justify-between border-t pt-1 font-bold">
                    <span>Section total</span>
                    <span style={{ color: accent }}>
                      {formatZAR(lineSub - discount + lineVat)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // attachments
        return (
          <div key={s.id} className="px-8 py-6">
            <h2 className="mb-3 text-lg font-bold" style={{ color: accent }}>
              {s.title || "Attachments"}
            </h2>
            <div className="flex flex-wrap gap-3">
              {(s.attachments || []).map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-32 flex-col items-center gap-1 rounded-lg border p-2 text-center text-[11px] hover:bg-slate-50"
                >
                  {a.mime?.startsWith("image/") ? (
                    <img src={a.url} alt={a.name} className="h-20 w-full rounded object-cover" loading="lazy" />
                  ) : (
                    <FileText className="h-10 w-10 text-slate-400" />
                  )}
                  <span className="w-full truncate">{a.name}</span>
                </a>
              ))}
              {(s.attachments || []).length === 0 && (
                <p className="text-xs text-slate-400">No attachments</p>
              )}
            </div>
          </div>
        );
      })}

      {total > 0 && (
        <div className="border-t px-8 py-5" style={{ backgroundColor: `${accent}0D` }}>
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <SummaryRow label="Subtotal" value={formatZAR(sub)} />
            <SummaryRow label="VAT (15%)" value={formatZAR(vat)} />
            <div className="flex justify-between border-t pt-2 text-lg font-bold">
              <span style={{ color: accent }}>Proposal total</span>
              <span style={{ color: accent }}>{formatZAR(total)}</span>
            </div>
          </div>
        </div>
      )}

      {requireSignature && (
        <div className="border-t px-8 py-6">
          <h2 className="mb-3 text-lg font-bold" style={{ color: accent }}>
            Acceptance
          </h2>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Client name</p>
              {interactive ? (
                <input
                  className="mt-1 w-full max-w-xs rounded border px-2 py-1 text-sm"
                  placeholder="Type your full name"
                  value={signerName || ""}
                  onChange={(e) => onSignerNameChange?.(e.target.value)}
                  disabled={!!signedAt}
                />
              ) : (
                <p className="mt-1 border-b border-slate-300 pb-1 text-sm">
                  {signerName || "\u00A0"}
                </p>
              )}
              {signedAt && (
                <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Accepted {new Date(signedAt).toLocaleString("en-ZA")}
                </p>
              )}
            </div>
            <Button
              type="button"
              style={{ backgroundColor: accent }}
              className="text-white hover:opacity-90"
              disabled={!interactive || !!signedAt || !(signerName || "").trim()}
              onClick={() => onAccept?.(signerName || "")}
            >
              <PenLine className="mr-2 h-4 w-4" />
              {signedAt ? "Accepted" : "Accept & Sign"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span className="text-slate-500">{label}</span>
    <span className="font-medium">{value}</span>
  </div>
);

const HeaderMeta = ({
  clientName,
  companyName,
  proposalNumber,
  dateLabel,
  centered,
}: {
  clientName?: string;
  companyName?: string;
  proposalNumber?: string;
  dateLabel: string;
  centered?: boolean;
}) => (
  <div className={`mt-3 space-y-0.5 text-sm text-slate-500 ${centered ? "text-center" : ""}`}>
    {companyName && <p>From {companyName}</p>}
    {clientName && (
      <p>
        Prepared for <strong className="text-slate-700">{clientName}</strong>
      </p>
    )}
    <p className="text-xs">
      {proposalNumber ? `${proposalNumber} · ` : ""}
      {dateLabel}
    </p>
  </div>
);

export default VisualProposalPreview;
