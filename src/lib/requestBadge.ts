import { typeLabel } from "@/lib/requests";
const SHORT: Record<string, string> = { installation: "Installation", service: "Service", repair: "Service", service_call: "Service", maintenance: "Service", quote: "Quote", survey: "Quote", quote_request: "Quote" };
/** Badge on a request card: the linked job's type when there is a job (one source of truth), else the request's triage type. */
export const requestBadgeLabel = (requestType?: string | null, jobType?: string | null) =>
  (jobType && (SHORT[jobType] || jobType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))) || typeLabel(requestType);
