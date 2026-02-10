import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, isValid } from "date-fns";

// ── Friendly field name mappings per table ──────────────────────────
const FIELD_LABELS: Record<string, Record<string, string>> = {
  leads: {
    customer_id: "Customer",
    assigned_agent_id: "Technician",
    customer_name: "Customer Name",
    customer_phone: "Phone",
    customer_address: "Address",
    service_type: "Service Type",
    status: "Status",
    priority: "Priority",
    scheduled_date: "Scheduled Date",
    scheduled_time: "Scheduled Time",
    started_at: "Started At",
    completed_at: "Completed At",
    accepted_at: "Accepted At",
    actual_start_time: "Actual Start",
    estimated_duration_minutes: "Est. Duration (min)",
    estimated_end_time: "Est. End Time",
    notes: "Notes",
    latitude: "Latitude",
    longitude: "Longitude",
    broadcast_radius_km: "Broadcast Radius (km)",
    equipment_id: "Equipment",
    agreement_id: "Service Agreement",
    unit_id: "Unit",
  },
  quotes: {
    customer_id: "Customer",
    sales_engineer_id: "Sales Engineer",
    lead_id: "Lead",
    quote_number: "Quote #",
    status: "Status",
    subtotal: "Subtotal",
    vat_rate: "VAT Rate",
    vat_amount: "VAT Amount",
    total: "Total",
    valid_until: "Valid Until",
    notes: "Notes",
    terms_text: "Terms",
    sent_at: "Sent At",
    viewed_at: "Viewed At",
    accepted_at: "Accepted At",
    declined_at: "Declined At",
    accepted_by: "Accepted By",
    discount_type: "Discount Type",
    discount_value: "Discount Value",
    reference_text: "Reference",
  },
  invoices: {
    customer_id: "Customer",
    agent_id: "Agent",
    lead_id: "Lead",
    quote_id: "Quote",
    invoice_number: "Invoice #",
    status: "Status",
    subtotal: "Subtotal",
    tax_rate: "Tax Rate",
    tax_amount: "Tax Amount",
    grand_total: "Grand Total",
    due_date: "Due Date",
    issue_date: "Issue Date",
    paid_date: "Paid Date",
    payment_method: "Payment Method",
    customer_name: "Customer Name",
    customer_phone: "Phone",
    customer_email: "Email",
    customer_address: "Address",
    notes: "Notes",
    equipment_id: "Equipment",
  },
  payments: {
    invoice_id: "Invoice",
    amount: "Amount",
    method: "Method",
    payment_date: "Payment Date",
    reference: "Reference",
    created_by: "Created By",
  },
  service_agreements: {
    customer_id: "Customer",
    equipment_id: "Equipment",
    unit_id: "Unit",
    contract_type: "Contract Type",
    frequency: "Frequency",
    price: "Price",
    start_date: "Start Date",
    end_date: "End Date",
    status: "Status",
    next_service_due: "Next Service Due",
    last_service_date: "Last Service Date",
    auto_generate_jobs: "Auto-generate Jobs",
    notes: "Notes",
  },
};

// Fields to skip in the diff view (noisy/internal)
const HIDDEN_FIELDS = new Set(["id", "created_at", "updated_at"]);

// ── Snake_case → Title Case fallback ────────────────────────────────
export function snakeToTitle(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function getFieldLabel(tableName: string, fieldName: string): string {
  return FIELD_LABELS[tableName]?.[fieldName] ?? snakeToTitle(fieldName);
}

export function shouldShowField(fieldName: string): boolean {
  return !HIDDEN_FIELDS.has(fieldName);
}

// ── UUID detection ──────────────────────────────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

// ── FK resolver map: field suffix → table + display column ──────────
const FK_RESOLVERS: Record<string, { table: string; column: string }> = {
  customer_id: { table: "customers", column: "name" },
  assigned_agent_id: { table: "profiles", column: "full_name" },
  agent_id: { table: "profiles", column: "full_name" },
  sales_engineer_id: { table: "profiles", column: "full_name" },
  created_by: { table: "profiles", column: "full_name" },
  reviewed_by: { table: "profiles", column: "full_name" },
  equipment_id: { table: "equipment", column: "model" },
  invoice_id: { table: "invoices", column: "invoice_number" },
  quote_id: { table: "quotes", column: "quote_number" },
  lead_id: { table: "leads", column: "customer_name" },
  agreement_id: { table: "service_agreements", column: "contract_type" },
  unit_id: { table: "customer_units", column: "label" },
};

// ── UUID resolution with cache ──────────────────────────────────────
const resolveCache = new Map<string, string>();

export async function resolveUUID(
  fieldName: string,
  uuid: string
): Promise<string | null> {
  const cacheKey = `${fieldName}:${uuid}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey)!;

  const resolver = FK_RESOLVERS[fieldName];
  if (!resolver) return null;

  try {
    const { data } = await supabase
      .from(resolver.table as any)
      .select(resolver.column)
      .eq("id", uuid)
      .single();

    const displayName = (data as any)?.[resolver.column] ?? null;
    if (displayName) {
      resolveCache.set(cacheKey, displayName);
    }
    return displayName;
  } catch {
    return null;
  }
}

// Batch resolve all UUIDs found in old_data / new_data
export async function resolveAllUUIDs(
  oldData: Record<string, any> | null,
  newData: Record<string, any> | null
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const promises: Promise<void>[] = [];

  const allData = { ...oldData, ...newData };
  for (const [field, value] of Object.entries(allData)) {
    if (isUUID(value) && FK_RESOLVERS[field]) {
      promises.push(
        resolveUUID(field, value).then((name) => {
          if (name) resolved.set(`${field}:${value}`, name);
        })
      );
    }
  }

  await Promise.all(promises);
  return resolved;
}

// ── Value formatting ────────────────────────────────────────────────
export function isDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // ISO date patterns
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = parseISO(value);
    return isValid(parsed);
  }
  return false;
}

export function formatDisplayValue(
  value: unknown,
  resolvedNames?: Map<string, string>,
  fieldName?: string
): { text: string; isNull: boolean; type: "null" | "bool" | "date" | "uuid" | "text" } {
  if (value === null || value === undefined) {
    return { text: "Not set", isNull: true, type: "null" };
  }

  if (typeof value === "boolean") {
    return { text: value ? "Yes" : "No", isNull: false, type: "bool" };
  }

  if (isDateString(value)) {
    try {
      const formatted = format(parseISO(value as string), "dd MMM yyyy, HH:mm");
      return { text: formatted, isNull: false, type: "date" };
    } catch {
      return { text: String(value), isNull: false, type: "text" };
    }
  }

  if (isUUID(value)) {
    const resolvedKey = fieldName ? `${fieldName}:${value}` : "";
    const resolved = resolvedNames?.get(resolvedKey);
    if (resolved) {
      return { text: resolved, isNull: false, type: "text" };
    }
    return { text: (value as string).slice(0, 8) + "…", isNull: false, type: "uuid" };
  }

  if (typeof value === "object") {
    return { text: JSON.stringify(value), isNull: false, type: "text" };
  }

  return { text: String(value), isNull: false, type: "text" };
}

// ── Compute change rows ─────────────────────────────────────────────
export interface ChangeRow {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
  changed: boolean;
}

export function computeChanges(
  tableName: string,
  action: string,
  oldData: Record<string, any> | null,
  newData: Record<string, any> | null
): ChangeRow[] {
  const rows: ChangeRow[] = [];

  if (action === "update" && oldData && newData) {
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
    for (const key of allKeys) {
      if (!shouldShowField(key)) continue;
      const oldVal = oldData[key];
      const newVal = newData[key];
      const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
      if (!changed) continue; // only show changed fields for updates
      rows.push({
        field: key,
        label: getFieldLabel(tableName, key),
        oldValue: oldVal,
        newValue: newVal,
        changed: true,
      });
    }
  } else {
    const data = newData || oldData || {};
    for (const [key, val] of Object.entries(data)) {
      if (!shouldShowField(key)) continue;
      rows.push({
        field: key,
        label: getFieldLabel(tableName, key),
        oldValue: action === "delete" ? val : undefined,
        newValue: action === "insert" ? val : undefined,
        changed: false,
      });
    }
  }

  return rows;
}

// ── Action header labels ────────────────────────────────────────────
const TABLE_DISPLAY_NAMES: Record<string, string> = {
  leads: "Lead",
  quotes: "Quote",
  invoices: "Invoice",
  payments: "Payment",
  service_agreements: "Service Agreement",
  customers: "Customer",
  equipment: "Equipment",
};

export function getActionHeader(tableName: string, action: string): string {
  const entity = TABLE_DISPLAY_NAMES[tableName] ?? snakeToTitle(tableName);
  const verb =
    action === "insert"
      ? "Created"
      : action === "update"
        ? "Updated"
        : action === "delete"
          ? "Deleted"
          : snakeToTitle(action);
  return `${entity} ${verb}`;
}
