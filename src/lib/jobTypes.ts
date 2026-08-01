/**
 * Canonical job categories — exactly three:
 *  - quote        → "New Quote"              (caller wants pricing / a quote, incl. quotes for new installs)
 *  - service      → "Technical Service Call" (repairs + general service / maintenance)
 *  - installation → "New Installation"       (only once a quote is accepted and the install is scheduled)
 */
export type JobTypeKey = "quote" | "service" | "installation";

export const JOB_TYPE_LABELS: Record<string, string> = {
  quote: "New Quote",
  service: "Technical Service Call",
  installation: "New Installation",
  // legacy values still present on older records
  survey: "New Quote",
  quote_request: "New Quote",
  service_call: "Technical Service Call",
  repair: "Technical Service Call",
  maintenance: "Technical Service Call",
};

export const JOB_TYPE_OPTIONS: { value: JobTypeKey; label: string }[] = [
  { value: "quote", label: "New Quote" },
  { value: "service", label: "Technical Service Call" },
  { value: "installation", label: "New Installation" },
];

export const jobTypeLabel = (type?: string | null): string => {
  if (!type) return "";
  return JOB_TYPE_LABELS[type] || type.replace(/_/g, " ");
};
