/**
 * Bill-to rules for invoices and quotes.
 * - When a client (customers row) is linked, the billing identity (name, company,
 *   full address, VAT number) comes from that client's company record.
 * - The lead / job / location address is only the SITE, shown as a separate
 *   "Site:" line when it differs from the billing address.
 * - Without a linked client, the lead/job address is used as the bill-to address.
 */
export interface BillToCustomer {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  primary_address_line1?: string | null;
  primary_address_line2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  address?: string | null;
  vat_number?: string | null;
  email?: string | null;
  phone?: string | null;
}

const clean = (s: string | null | undefined) => (s ?? "").toString().trim();

/** Full company address: line 1, line 2, city, postal code (legacy `address` as fallback). */
export function formatCustomerAddress(c: BillToCustomer | null | undefined): string | null {
  if (!c) return null;
  const line1 = clean(c.primary_address_line1);
  const has = (part: string) => !!part && line1.toLowerCase().includes(part.toLowerCase());
  // Some clients have the whole address in line 1; don't repeat city / postal code.
  const cityPostal = [clean(c.city), clean(c.postal_code)].filter((x) => x && !has(x)).join(" ");
  const parts = [line1, has(clean(c.primary_address_line2)) ? "" : clean(c.primary_address_line2), cityPostal].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return clean(c.address) || null;
}

export function customerDisplayName(c: BillToCustomer | null | undefined): string | null {
  if (!c) return null;
  const n = clean(c.name) || [clean(c.first_name), clean(c.last_name)].filter(Boolean).join(" ");
  return n || null;
}

export interface BillTo {
  name: string;
  company: string | null;
  address: string | null;
  vat: string | null;
}

export function resolveBillTo(opts: {
  customer?: BillToCustomer | null;
  fallbackName?: string | null;
  fallbackAddress?: string | null;
  fallbackVat?: string | null;
}): BillTo {
  const c = opts.customer;
  if (c) {
    const name = customerDisplayName(c) || clean(opts.fallbackName);
    const company = clean(c.company_name);
    return {
      name,
      company: company && company !== name ? company : null,
      address: formatCustomerAddress(c),
      vat: clean(c.vat_number) || clean(opts.fallbackVat) || null,
    };
  }
  return {
    name: clean(opts.fallbackName),
    company: null,
    address: clean(opts.fallbackAddress) || null,
    vat: clean(opts.fallbackVat) || null,
  };
}

const norm = (s: string | null | undefined) =>
  clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Site address to print, or null when empty / same as the billing address. */
export function siteLineFor(site: string | null | undefined, billing: string | null | undefined): string | null {
  const s = clean(site);
  if (!s || s.toUpperCase() === "N/A") return null;
  const a = norm(s);
  const b = norm(billing);
  if (b && (a === b || b.startsWith(a) || a.startsWith(b))) return null;
  return s;
}

export const CUSTOMER_BILLTO_COLUMNS =
  "name, first_name, last_name, company_name, primary_address_line1, primary_address_line2, city, postal_code, address, vat_number, email, phone";
