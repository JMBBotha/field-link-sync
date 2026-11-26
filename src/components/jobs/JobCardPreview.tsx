/**
 * Short preview of the job / warranty card on Finish job.
 * The client still signs on the existing optional pad. Prices are not shown.
 */
import { useQuery } from "@tanstack/react-query";
import { buildJobCard, companyForJobCard, jobCardPreviewLines } from "@/lib/jobCard";
import { loadJobCardFacts } from "@/lib/jobCardLoad";
import type { JobCardMaterialInput } from "@/lib/jobCard";

interface JobCardPreviewProps {
  open: boolean;
  jobId?: string | null;
  leadId: string;
  clientName?: string | null;
  workDone: string;
  techName: string;
  signature: string | null;
  signerName?: string | null;
  completedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  labourMinutes?: number | null;
  extras?: JobCardMaterialInput[];
}

export default function JobCardPreview({
  open, jobId, leadId, clientName, workDone, techName, signature, signerName,
  completedAt, startedAt, finishedAt, labourMinutes, extras = [],
}: JobCardPreviewProps) {
  const { data: facts } = useQuery({
    queryKey: ["job-card-preview", jobId, leadId],
    enabled: open && !!jobId,
    queryFn: () => loadJobCardFacts(jobId as string, leadId, { includePhotoBytes: false }),
  });
  const times = facts?.times?.length
    ? facts.times
    : [{ start: startedAt, end: finishedAt, minutes: labourMinutes }];
  const model = buildJobCard({
    company: facts?.company || companyForJobCard(null, null),
    clientName,
    clientVat: facts?.clientVat,
    siteAddress: facts?.siteAddress,
    jobTitle: facts?.jobTitle,
    jobType: facts?.jobType,
    jobDates: [...(facts?.jobDates || []), startedAt, completedAt],
    completedAt,
    workDone,
    units: facts?.units,
    photos: (facts?.photos || []).map((p) => ({ label: p.label, caption: p.caption, dataUrl: null })),
    materials: [...(facts?.materials || []), ...extras],
    times,
    labourMinutes,
    technicianName: techName,
    signatureDataUrl: signature,
    signerName,
  });
  const lines = jobCardPreviewLines(model);

  return (
    <section className="overflow-hidden rounded-xl border border-border" data-testid="job-card-preview">
      <div className="px-3 py-2 text-sm font-bold text-white" style={{ background: "#3D9BE8" }}>
        Job / warranty card
      </div>
      <div className="space-y-1.5 p-3 text-sm">
        <p className="text-muted-foreground">This is what the client will sign. Prices are not on this card.</p>
        {lines.map((line) => (
          <p key={line.label}><span className="font-semibold">{line.label}. </span>{line.value}</p>
        ))}
        <p className="font-semibold" style={{ color: "#C2410C" }}>Warranty</p>
        <p>{model.labourWarranty}</p>
        <p className="text-xs text-muted-foreground">{model.warrantyLines[0]}</p>
        {model.signed ? (
          <p data-testid="job-card-signed">Signed by {model.signatureName} on {model.signatureDate}</p>
        ) : (
          <p className="font-semibold" data-testid="job-card-unsigned" style={{ color: "#C2410C" }}>{model.unsignedLabel}</p>
        )}
        <p className="text-xs text-muted-foreground">{model.popia}</p>
      </div>
    </section>
  );
}
