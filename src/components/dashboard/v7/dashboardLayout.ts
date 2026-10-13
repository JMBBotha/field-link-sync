/**
 * New-layout dashboard order (Johan 13 Oct 14:05; "changeable later"). Edit this list to reorder:
 * each row lists block ids rendered left→right; blocks a role may not see simply drop out.
 * Johan 13 Oct 15:04: Open leads + Upcoming jobs (top_lists) grouped with the top row as one top section.
 * Slots from AdminHome: top_lists, todays_leads, ready_to_invoice, booked_jobs, pipeline_health, lead_to_paid.
 */
export type DashRowCfg = { id: string; title?: string; grid: string; items: string[]; span?: Record<string, string>; office?: boolean };
export const DASHBOARD_LAYOUT: DashRowCfg[] = [
  { id: "flow", title: "Company flow", grid: "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3",
    items: ["top_lists", "todays_leads", "ready_to_invoice", "booked_jobs"], span: { top_lists: "md:col-span-2 xl:col-span-3" } },
  { id: "front", title: "Front-end performance", grid: "grid grid-cols-1 gap-3 lg:grid-cols-3",
    items: ["period_bar", "quote_conversion", "pipeline_health", "quotes_sent", "quotes_accepted", "new_leads", "lead_funnel"],
    span: { period_bar: "lg:col-span-3", pipeline_health: "lg:col-span-2", lead_funnel: "lg:col-span-3" } },
  { id: "money", title: "Money", grid: "grid grid-cols-2 gap-3 lg:grid-cols-4",
    items: ["compare_to", "invoices_paid", "outstanding", "draft_invoices", "paid_period", "revenue_ytd", "monthly_revenue", "lead_to_paid", "outstanding_share", "aging", "cash_flow", "compare_table"],
    span: { compare_to: "col-span-2 lg:col-span-4", invoices_paid: "col-span-2 lg:col-span-1", monthly_revenue: "col-span-2 lg:col-span-4", lead_to_paid: "col-span-2 lg:col-span-4", outstanding_share: "col-span-2", aging: "col-span-2", cash_flow: "col-span-2 lg:col-span-4", compare_table: "col-span-2 lg:col-span-4" } },
  { id: "support", title: "Supporting", grid: "grid grid-cols-1 gap-3 lg:grid-cols-2",
    items: ["job_status", "open_jobs", "leads_inbox", "team"], span: { leads_inbox: "lg:col-span-2", team: "lg:col-span-2" } },
];
