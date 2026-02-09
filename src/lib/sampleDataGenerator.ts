import { supabase } from "@/integrations/supabase/client";

// Cape Town area coordinates
const CAPE_TOWN_LOCATIONS = [
  { name: "Sea Point", lat: -33.9172, lng: 18.3874, address: "12 Main Rd, Sea Point, Cape Town 8005" },
  { name: "Claremont", lat: -33.9833, lng: 18.4667, address: "45 Belvedere Rd, Claremont, Cape Town 7708" },
  { name: "Bellville", lat: -33.9000, lng: 18.6333, address: "8 Durban Rd, Bellville, Cape Town 7530" },
  { name: "Constantia", lat: -34.0289, lng: 18.4317, address: "22 Spaanschemat River Rd, Constantia, Cape Town 7806" },
  { name: "Milnerton", lat: -33.8667, lng: 18.5167, address: "100 Koeberg Rd, Milnerton, Cape Town 7441" },
  { name: "Woodstock", lat: -33.9267, lng: 18.4467, address: "3 Albert Rd, Woodstock, Cape Town 7925" },
  { name: "Gardens", lat: -33.9367, lng: 18.4100, address: "15 Kloof St, Gardens, Cape Town 8001" },
  { name: "Observatory", lat: -33.9383, lng: 18.4733, address: "77 Lower Main Rd, Observatory, Cape Town 7925" },
  { name: "Parow", lat: -33.9000, lng: 18.5833, address: "28 Voortrekker Rd, Parow, Cape Town 7500" },
  { name: "Camps Bay", lat: -33.9500, lng: 18.3800, address: "5 Victoria Rd, Camps Bay, Cape Town 8040" },
];

const CUSTOMER_NAMES = [
  { name: "Johan van der Merwe", phone: "+27821234567", email: "johan@example.co.za" },
  { name: "Fatima Abrahams", phone: "+27839876543", email: "fatima@example.co.za" },
  { name: "Sipho Ndlovu", phone: "+27844567890", email: "sipho@example.co.za" },
  { name: "Annemarie Botha", phone: "+27851239876", email: "annemarie@example.co.za" },
  { name: "David Petersen", phone: "+27867894561", email: "david@example.co.za" },
];

const SERVICE_TYPES = ["AC Installation", "AC Repair", "AC Maintenance", "Refrigeration Repair", "Ventilation Install"];
const PRIORITIES = ["normal", "normal", "normal", "high", "urgent"];
const STATUSES = ["pending", "pending", "accepted", "en_route", "on_site", "completed", "completed", "completed", "completed", "completed"];

const CATALOG_PRODUCTS = [
  { code: "MDV-09HRFN1", desc: "Midea 9000 BTU Split Unit Indoor", category: "Split Units", cost: 3200, sell: 4800, btu: 9000 },
  { code: "MDV-12HRFN1", desc: "Midea 12000 BTU Split Unit Indoor", category: "Split Units", cost: 4100, sell: 6150, btu: 12000 },
  { code: "MDV-18HRFN1", desc: "Midea 18000 BTU Split Unit Indoor", category: "Split Units", cost: 5800, sell: 8700, btu: 18000 },
  { code: "MDV-24HRFN1", desc: "Midea 24000 BTU Split Unit Indoor", category: "Split Units", cost: 7500, sell: 11250, btu: 24000 },
  { code: "MDV-36HRFN1", desc: "Midea 36000 BTU Floor Standing", category: "Floor Standing", cost: 12000, sell: 18000, btu: 36000 },
  { code: "MOU-09HRFN1", desc: "Midea 9000 BTU Outdoor Condenser", category: "Condensers", cost: 3000, sell: 4500, btu: 9000 },
  { code: "MOU-12HRFN1", desc: "Midea 12000 BTU Outdoor Condenser", category: "Condensers", cost: 3800, sell: 5700, btu: 12000 },
  { code: "MOU-18HRFN1", desc: "Midea 18000 BTU Outdoor Condenser", category: "Condensers", cost: 5200, sell: 7800, btu: 18000 },
  { code: "MCA-12HRN1", desc: "Midea Cassette 12000 BTU", category: "Cassettes", cost: 6500, sell: 9750, btu: 12000 },
  { code: "MCA-18HRN1", desc: "Midea Cassette 18000 BTU", category: "Cassettes", cost: 8200, sell: 12300, btu: 18000 },
  { code: "MDT-24HRN1", desc: "Midea Ducted 24000 BTU", category: "Ducted", cost: 14000, sell: 21000, btu: 24000 },
  { code: "MDT-36HRN1", desc: "Midea Ducted 36000 BTU", category: "Ducted", cost: 18000, sell: 27000, btu: 36000 },
  { code: "PIPE-6MM", desc: "Copper Pipe 6mm (per meter)", category: "Accessories", cost: 45, sell: 85, btu: null },
  { code: "PIPE-10MM", desc: "Copper Pipe 10mm (per meter)", category: "Accessories", cost: 65, sell: 120, btu: null },
  { code: "PIPE-12MM", desc: "Copper Pipe 12mm (per meter)", category: "Accessories", cost: 85, sell: 150, btu: null },
  { code: "BRACKET-STD", desc: "Standard Wall Bracket", category: "Accessories", cost: 120, sell: 250, btu: null },
  { code: "DRAIN-KIT", desc: "Condensate Drain Kit", category: "Accessories", cost: 80, sell: 180, btu: null },
  { code: "R410A-10KG", desc: "R410A Refrigerant 10kg", category: "Refrigerant", cost: 1200, sell: 2400, btu: null },
  { code: "R22-10KG", desc: "R22 Refrigerant 10kg", category: "Refrigerant", cost: 900, sell: 1800, btu: null },
  { code: "FILTER-UNI", desc: "Universal Filter Replacement", category: "Accessories", cost: 45, sell: 120, btu: null },
];

export interface SampleDataResult {
  customers: number;
  leads: number;
  products: number;
  agreements: number;
  invoices: number;
  feedback: number;
}

export async function generateSampleData(): Promise<SampleDataResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("You must be logged in to generate sample data");
  const userId = session.user.id;

  const result: SampleDataResult = { customers: 0, leads: 0, products: 0, agreements: 0, invoices: 0, feedback: 0 };

  // 1. Create supplier (Midea)
  const { data: existingSupplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("name", "Midea (Sample)")
    .maybeSingle();

  let supplierId: string;
  if (existingSupplier) {
    supplierId = existingSupplier.id;
  } else {
    const { data: sup, error: supErr } = await supabase
      .from("suppliers")
      .insert({ name: "Midea (Sample)", contact_name: "Midea SA Sales", contact_email: "sales@midea.co.za", contact_phone: "+27115551234", website: "https://midea.co.za" })
      .select("id")
      .single();
    if (supErr) throw supErr;
    supplierId = sup.id;
  }

  // 2. Create catalog products
  const productInserts = CATALOG_PRODUCTS.map(p => ({
    supplier_id: supplierId,
    product_code: p.code,
    description: p.desc,
    category: p.category,
    cost_price: p.cost,
    selling_price: p.sell,
    btu_rating: p.btu,
    refrigerant_type: p.btu ? "R410A" : null,
    is_active: true,
    default_markup_percent: 50,
  }));

  const { data: products, error: prodErr } = await supabase
    .from("supplier_products")
    .upsert(productInserts, { onConflict: "supplier_id,product_code" })
    .select("id");
  if (prodErr) throw prodErr;
  result.products = products?.length || CATALOG_PRODUCTS.length;

  // 3. Create customers
  const customerInserts = CUSTOMER_NAMES.map((c, i) => ({
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: CAPE_TOWN_LOCATIONS[i].address,
    area: CAPE_TOWN_LOCATIONS[i].name,
    latitude: CAPE_TOWN_LOCATIONS[i].lat,
    longitude: CAPE_TOWN_LOCATIONS[i].lng,
    created_by: userId,
    data_consent: true,
    data_consent_date: new Date().toISOString(),
  }));

  const { data: customers, error: custErr } = await supabase
    .from("customers")
    .insert(customerInserts)
    .select("id");
  if (custErr) throw custErr;
  result.customers = customers?.length || 0;

  // 4. Create leads/jobs
  const now = new Date();
  const leadInserts = Array.from({ length: 10 }, (_, i) => {
    const loc = CAPE_TOWN_LOCATIONS[i];
    const custIdx = i % customers!.length;
    const daysAgo = Math.floor(Math.random() * 14);
    const created = new Date(now.getTime() - daysAgo * 86400000);
    const status = STATUSES[i];
    return {
      customer_name: CUSTOMER_NAMES[custIdx].name,
      customer_phone: CUSTOMER_NAMES[custIdx].phone,
      customer_address: loc.address,
      service_type: SERVICE_TYPES[i % SERVICE_TYPES.length],
      status,
      latitude: loc.lat + (Math.random() - 0.5) * 0.01,
      longitude: loc.lng + (Math.random() - 0.5) * 0.01,
      priority: PRIORITIES[i % PRIORITIES.length],
      customer_id: customers![custIdx].id,
      assigned_agent_id: ["accepted", "en_route", "on_site", "completed"].includes(status) ? userId : null,
      created_at: created.toISOString(),
      started_at: ["on_site", "completed"].includes(status) ? new Date(created.getTime() + 3600000).toISOString() : null,
      completed_at: status === "completed" ? new Date(created.getTime() + 7200000).toISOString() : null,
      notes: `Sample job #${i + 1} — ${loc.name} area`,
      scheduled_date: new Date(now.getTime() + (i - 5) * 86400000).toISOString().split("T")[0],
    };
  });

  const { data: leads, error: leadErr } = await supabase
    .from("leads")
    .insert(leadInserts)
    .select("id, customer_id, status, assigned_agent_id");
  if (leadErr) throw leadErr;
  result.leads = leads?.length || 0;

  // 5. Create service agreements for first 3 customers
  const agreementInserts = customers!.slice(0, 3).map((c, i) => ({
    customer_id: c.id,
    contract_type: "annual_ac_maintenance",
    frequency: i === 0 ? "quarterly" : "annual",
    start_date: new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0],
    end_date: new Date(now.getFullYear(), 11, 31).toISOString().split("T")[0],
    price: [3600, 2400, 4800][i],
    status: "active",
    auto_generate_jobs: true,
    next_service_due: new Date(now.getTime() + 30 * 86400000).toISOString().split("T")[0],
    created_by: userId,
    notes: `Sample agreement #${i + 1}`,
  }));

  const { error: agrErr } = await supabase.from("service_agreements").insert(agreementInserts);
  if (agrErr) throw agrErr;
  result.agreements = agreementInserts.length;

  // 6. Create invoices for completed leads
  const completedLeads = leads!.filter(l => l.status === "completed" && l.assigned_agent_id);
  for (let i = 0; i < completedLeads.length; i++) {
    const lead = completedLeads[i];
    const lineItems = [
      { description: SERVICE_TYPES[i % SERVICE_TYPES.length], quantity: 1, unit_price: 1500 + i * 200, amount: 1500 + i * 200 },
      { description: "Call-out Fee", quantity: 1, unit_price: 450, amount: 450 },
    ];
    const subtotal = lineItems.reduce((s, li) => s + li.amount, 0);
    const taxAmount = Math.round(subtotal * 0.15 * 100) / 100;

    const { error: invErr } = await supabase.from("invoices").insert({
      lead_id: lead.id,
      agent_id: lead.assigned_agent_id!,
      customer_name: CUSTOMER_NAMES[i % CUSTOMER_NAMES.length].name,
      customer_phone: CUSTOMER_NAMES[i % CUSTOMER_NAMES.length].phone,
      customer_email: CUSTOMER_NAMES[i % CUSTOMER_NAMES.length].email,
      customer_address: CAPE_TOWN_LOCATIONS[i % CAPE_TOWN_LOCATIONS.length].address,
      customer_id: lead.customer_id,
      invoice_number: `INV-SAMPLE-${String(i + 1).padStart(3, "0")}`,
      line_items: lineItems,
      subtotal,
      tax_rate: 15,
      tax_amount: taxAmount,
      grand_total: subtotal + taxAmount,
      status: i < 3 ? "paid" : "sent",
      issue_date: new Date().toISOString().split("T")[0],
      due_date: new Date(now.getTime() + 30 * 86400000).toISOString().split("T")[0],
      paid_date: i < 3 ? new Date().toISOString().split("T")[0] : null,
      payment_method: i < 3 ? "eft" : null,
    });
    if (invErr) console.warn("Invoice insert error:", invErr);
    else result.invoices++;
  }

  // 7. Create feedback for first 3 completed leads
  for (let i = 0; i < Math.min(3, completedLeads.length); i++) {
    const lead = completedLeads[i];
    const { error: fbErr } = await supabase.from("customer_feedback").insert({
      customer_id: lead.customer_id!,
      lead_id: lead.id,
      agent_id: lead.assigned_agent_id!,
      rating: [5, 4, 5][i],
      comment: ["Excellent service, very professional!", "Good work, arrived on time.", "Great job, highly recommended!"][i],
    });
    if (fbErr) console.warn("Feedback insert error:", fbErr);
    else result.feedback++;
  }

  return result;
}

export async function clearSampleData(): Promise<void> {
  // Delete in reverse dependency order
  await supabase.from("customer_feedback").delete().like("comment", "%Sample%").throwOnError();
  await supabase.from("invoices").delete().like("invoice_number", "INV-SAMPLE-%");
  await supabase.from("service_agreements").delete().like("notes", "Sample agreement%");
  await supabase.from("leads").delete().like("notes", "Sample job%");
  await supabase.from("customers").delete().in("phone", CUSTOMER_NAMES.map(c => c.phone));
  await supabase.from("supplier_products").delete().eq("supplier_id", 
    (await supabase.from("suppliers").select("id").eq("name", "Midea (Sample)").maybeSingle()).data?.id || ""
  );
  await supabase.from("suppliers").delete().eq("name", "Midea (Sample)");
}
