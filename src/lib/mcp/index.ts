import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listLeads from "./tools/list-leads";
import listJobs from "./tools/list-jobs";
import getJob from "./tools/get-job";
import listCustomers from "./tools/list-customers";
import listQuotes from "./tools/list-quotes";
import listInvoices from "./tools/list-invoices";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "field-link-sync-mcp",
  title: "0800-BE-COOL Field Service MCP",
  version: "0.1.0",
  instructions:
    "Read-only access to the signed-in user's field service data: leads, jobs, customers, quotes, and invoices. All queries are RLS-scoped to the authenticated user's company.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listLeads, listJobs, getJob, listCustomers, listQuotes, listInvoices],
});
