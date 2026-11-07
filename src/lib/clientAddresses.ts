/**
 * Client private / company / home / work.
 * Private contact and company name/VAT stay on the customers row and save as separate fields.
 * Home and Work are customer_locations labelled "Home" and "Work".
 * The work address is also the billing address (primary_address_*), so invoices do not bill to Home.
 */

export const HOME_LABEL = "Home" as const;
export const WORK_LABEL = "Work" as const;
export type AddressKind = typeof HOME_LABEL | typeof WORK_LABEL;

export interface WorkAddressFields {
  line1: string;
  line2: string;
  city: string;
  postal: string;
}

export interface LocationRef {
  id: string;
  label?: string | null;
  address?: string | null;
  is_primary?: boolean | null;
}

const trim = (s: string | null | undefined) => (s ?? "").trim();

export function isAddressLabel(label: string | null | undefined, kind: AddressKind) {
  return trim(label).toLowerCase() === kind.toLowerCase();
}

export function findLabeledLocation<T extends { label?: string | null }>(rows: T[], kind: AddressKind): T | undefined {
  return rows.find((r) => isAddressLabel(r.label, kind));
}

/** Header title: company name only when the client is marked a company AND a company name is on file. */
export function clientHeaderName(c: {
  is_company?: boolean | null;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
}) {
  const company = trim(c.company_name);
  const person = `${c.first_name || ""} ${c.last_name || ""}`.trim() || trim(c.name);
  if (c.is_company && company) return company;
  return person || "Unnamed";
}

/** Company-name save. Does not include name, phone, or email. */
export function companyNamePatch(companyName: string | null | undefined) {
  const name = trim(companyName);
  return { company_name: name || null, is_company: name.length > 0 };
}

/** The part of a company-name save that update_entity accepts (is_company is not in that allow-list). */
export function companyEntityPatch(companyName: string | null | undefined) {
  return { company_name: companyNamePatch(companyName).company_name };
}

export function formatStoredAddress(parts: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  postal?: string | null;
}) {
  return [parts.line1, parts.line2, parts.city, parts.postal].map(trim).filter(Boolean).join(", ");
}

/** Billing columns used by billTo. Does not include name, phone, email, or company_name. */
export function workBillingPatch(work: WorkAddressFields) {
  const line1 = trim(work.line1);
  const line2 = trim(work.line2);
  const city = trim(work.city);
  const postal = trim(work.postal);
  return {
    primary_address_line1: line1 || null,
    primary_address_line2: line2 || null,
    city: city || null,
    postal_code: postal || null,
    address: formatStoredAddress({ line1, line2, city, postal }) || null,
  };
}

export function initialWorkFields(
  customer: {
    primary_address_line1?: string | null;
    primary_address_line2?: string | null;
    city?: string | null;
    postal_code?: string | null;
  },
  locations: { label?: string | null; address?: string | null }[],
): WorkAddressFields {
  const fromCustomer: WorkAddressFields = {
    line1: trim(customer.primary_address_line1),
    line2: trim(customer.primary_address_line2),
    city: trim(customer.city),
    postal: trim(customer.postal_code),
  };
  if (fromCustomer.line1 || fromCustomer.line2 || fromCustomer.city || fromCustomer.postal) return fromCustomer;
  const work = findLabeledLocation(locations, WORK_LABEL);
  if (trim(work?.address)) return { line1: trim(work?.address), line2: "", city: "", postal: "" };
  return fromCustomer;
}

export function initialHomeAddress(locations: { label?: string | null; address?: string | null }[]) {
  return trim(findLabeledLocation(locations, HOME_LABEL)?.address);
}

export type LocationWrite =
  | { op: "update"; id: string; address: string; label: AddressKind }
  | { op: "insert"; address: string; label: AddressKind; is_primary: boolean }
  | { op: "skip" };

/**
 * Create or update the Home or Work row. Other labels are left alone (never deleted).
 * An existing row keeps its is_primary flag. A new Work row is primary only when nothing else is,
 * so invoices' site default is not stolen from a real site. Home is never forced primary —
 * invoices bill to the customer primary address, which is the work address.
 */
export function planLocationWrite(opts: {
  kind: AddressKind;
  address: string;
  locations: LocationRef[];
}): LocationWrite {
  const existing = findLabeledLocation(opts.locations, opts.kind);
  const address = trim(opts.address);
  if (existing) return { op: "update", id: existing.id, address, label: opts.kind };
  if (!address) return { op: "skip" };
  const hasPrimary = opts.locations.some((r) => !!r.is_primary);
  return { op: "insert", address, label: opts.kind, is_primary: opts.kind === WORK_LABEL && !hasPrimary };
}

export interface LocationDb {
  update: (id: string, patch: { label: string; address: string }) => Promise<void>;
  insert: (row: {
    customer_id: string;
    company_id: string;
    label: string;
    address: string;
    is_primary: boolean;
  }) => Promise<void>;
}

export async function applyLocationWrite(
  db: LocationDb,
  args: {
    customerId: string;
    companyId: string;
    kind: AddressKind;
    address: string;
    locations: LocationRef[];
  },
) {
  const plan = planLocationWrite({ kind: args.kind, address: args.address, locations: args.locations });
  if (plan.op === "update") await db.update(plan.id, { label: plan.label, address: plan.address });
  if (plan.op === "insert") {
    await db.insert({
      customer_id: args.customerId,
      company_id: args.companyId,
      label: plan.label,
      address: plan.address,
      is_primary: plan.is_primary,
    });
  }
  return plan;
}

/** Rows to insert when a client is created. Does not touch any existing location. */
export function locationsToCreate(opts: {
  customerId: string;
  companyId: string;
  homeAddress: string;
  workAddress: string;
}) {
  const rows: {
    customer_id: string;
    company_id: string;
    label: string;
    address: string;
    is_primary: boolean;
  }[] = [];
  const work = planLocationWrite({ kind: WORK_LABEL, address: opts.workAddress, locations: [] });
  if (work.op === "insert") {
    rows.push({
      customer_id: opts.customerId,
      company_id: opts.companyId,
      label: work.label,
      address: work.address,
      is_primary: work.is_primary,
    });
  }
  const home = planLocationWrite({
    kind: HOME_LABEL,
    address: opts.homeAddress,
    locations: rows.map((r) => ({ id: "new", label: r.label, is_primary: r.is_primary })),
  });
  if (home.op === "insert") {
    rows.push({
      customer_id: opts.customerId,
      company_id: opts.companyId,
      label: home.label,
      address: home.address,
      is_primary: home.is_primary,
    });
  }
  return rows;
}
