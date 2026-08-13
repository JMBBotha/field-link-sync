/**
 * Central registry describing every editable entity type.
 *
 * Every details popup is a thin wrapper around this: it declares an entity type
 * and a list of visible fields, and the shared editor takes care of loading,
 * mutating (via the `update_entity` RPC), optimistic cache patching and realtime.
 */

export type EntityType = "lead" | "job" | "client" | "project";

export type EditableFieldKind =
  | "text"
  | "number"
  | "email"
  | "tel"
  | "textarea"
  | "select"
  | "date"
  | "time"
  | "datetime";

export interface EntityFieldConfig {
  /** Column name on the underlying table. */
  key: string;
  label: string;
  kind: EditableFieldKind;
  /** Options for `select` fields. */
  options?: { value: string; label: string }[];
  /** Resolve options dynamically (e.g. agents list) via the form's optionSources. */
  optionSource?: "agents" | "customers" | "fb_contacts";
  placeholder?: string;
  /** Rendered full width in the two-column grid. */
  wide?: boolean;
}

export interface EntityConfig {
  type: EntityType;
  table: string;
  label: string;
  /** Columns fetched for the single-entity query. */
  select: string;
  /**
   * Every TanStack Query key root that can hold a copy of this entity.
   * Optimistic updates patch all of them, so boards/calendars/lists never go stale.
   */
  cacheKeys: string[];
  fields: EntityFieldConfig[];
}

const LEAD_STATUS = [
  "pending",
  "accepted",
  "claimed",
  "in_progress",
  "completed",
  "cancelled",
].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

const JOB_STATUS = [
  "scheduled",
  "dispatched",
  "in_progress",
  "completed",
  "cancelled",
].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

const PRIORITY = ["low", "normal", "high", "urgent"].map((v) => ({
  value: v,
  label: v,
}));

export const ENTITY_REGISTRY: Record<EntityType, EntityConfig> = {
  lead: {
    type: "lead",
    table: "leads",
    label: "Job",
    select: "*",
    cacheKeys: [
      "lead",
      "leads",
      "dispatch-leads",
      "map-leads",
      "offline-leads",
      "completed-leads",
      "schedulable-leads",
      "unassigned-queue",
      "my-jobs",
      "job-schedules",
      "dispatch-schedules",
    ],
    fields: [
      { key: "customer_name", label: "Customer", kind: "text" },
      { key: "customer_phone", label: "Phone", kind: "tel" },
      { key: "customer_address", label: "Address", kind: "text", wide: true },
      { key: "service_type", label: "Job Type", kind: "text" },
      { key: "status", label: "Status", kind: "select", options: LEAD_STATUS },
      { key: "priority", label: "Priority", kind: "select", options: PRIORITY },
      {
        key: "assigned_agent_id",
        label: "Assigned To",
        kind: "select",
        optionSource: "agents",
      },
      { key: "scheduled_date", label: "Scheduled Date", kind: "date" },
      { key: "scheduled_time", label: "Start Time", kind: "time" },
      {
        key: "order_status",
        label: "Order Status",
        kind: "select",
        options: ["not_required", "pending", "ordered", "received"].map((v) => ({
          value: v,
          label: v.replace(/_/g, " "),
        })),
      },
      {
        key: "parts_status",
        label: "Parts Status",
        kind: "select",
        options: ["not_required", "awaiting", "in_stock", "collected"].map((v) => ({
          value: v,
          label: v.replace(/_/g, " "),
        })),
      },
      { key: "notes", label: "Notes", kind: "textarea", wide: true },
    ],
  },
  job: {
    type: "job",
    table: "jobs",
    label: "Job",
    select: "*",
    cacheKeys: ["job", "job-detail", "jobs", "jobs-dispatch", "my-jobs", "jobs-map"],
    fields: [
      { key: "title", label: "Title", kind: "text", wide: true },
      { key: "status", label: "Status", kind: "select", options: JOB_STATUS },
      { key: "priority", label: "Priority", kind: "select", options: PRIORITY },
      { key: "job_type", label: "Job Type", kind: "text" },
      { key: "scheduled_for", label: "Scheduled For", kind: "datetime" },
      { key: "estimated_duration", label: "Est. Duration", kind: "text" },
      { key: "address", label: "Address", kind: "text", wide: true },
      { key: "description", label: "Description", kind: "textarea", wide: true },
    ],
  },
  client: {
    type: "client",
    table: "customers",
    label: "Client",
    select: "*",
    cacheKeys: [
      "client",
      "customer-detail",
      "customers",
      "unified-clients",
      "customer-search",
    ],
    fields: [
      { key: "name", label: "Name", kind: "text" },
      { key: "company_name", label: "Company", kind: "text" },
      { key: "phone", label: "Phone", kind: "tel" },
      { key: "secondary_phone", label: "Alt Phone", kind: "tel" },
      { key: "email", label: "Email", kind: "email" },
      { key: "primary_address_line1", label: "Address", kind: "text", wide: true },
      { key: "city", label: "City", kind: "text" },
      { key: "postal_code", label: "Postal Code", kind: "text" },
      { key: "vat_number", label: "VAT Number", kind: "text" },
      {
        key: "status",
        label: "Status",
        kind: "select",
        options: ["lead", "active", "inactive", "archived"].map((v) => ({
          value: v,
          label: v,
        })),
      },
      { key: "notes", label: "Notes", kind: "textarea", wide: true },
    ],
  },
  project: {
    type: "project",
    table: "fb_projects",
    label: "Project",
    select: "*",
    cacheKeys: ["project", "fb-projects", "fb-project-detail", "projects"],
    fields: [
      { key: "name", label: "Project Name", kind: "text", wide: true },
      {
        key: "status",
        label: "Status",
        kind: "select",
        options: ["active", "on_hold", "completed", "archived"].map((v) => ({
          value: v,
          label: v.replace(/_/g, " "),
        })),
      },
      { key: "budget", label: "Budget (R)", kind: "number" },
      {
        key: "client_id",
        label: "Client",
        kind: "select",
        optionSource: "fb_contacts",
        wide: true,
      },
    ],
  },
};


export const getEntityConfig = (type: EntityType) => ENTITY_REGISTRY[type];
