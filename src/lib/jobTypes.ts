export const JOB_TYPE_LABELS: Record<string, string> = {
  installation: "Installation",
  service: "Technical Service Call",
  service_call: "Technical Service Call",
  repair: "Repair",
  survey: "Survey",
  maintenance: "Maintenance",
};

export const jobTypeLabel = (type?: string | null): string => {
  if (!type) return "";
  return JOB_TYPE_LABELS[type] || type.replace(/_/g, " ");
};
