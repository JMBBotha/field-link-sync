/**
 * parse-price-list — legacy spreadsheet/price-list parser.
 *
 * NOT the brochure import path. The Visual-PDF catalog source of truth is
 * SupplierDocumentsTab -> src/services/diffImportPipeline.ts, which does the
 * brand-scoped insert / update / archive-on-missing diff. This function only
 * inserts and updates rows and deliberately never archives missing SKUs, so it
 * must not be used to publish a new brochure book for a brand.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParsedProduct {
  product_code: string;
  description: string;
  category: string;
  pipe_size: string | null;
  cost_price: number;
  is_price_on_request: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Price data feeds customer quoting — restrict imports to admins.
  const auth = await requireUser(req, ["admin", "platform_super_admin", "platform_ops"]);
  if (!auth.ok) return auth.response;

  try {
    const { csv_text, supplier_id, supplier_name } = await req.json();

    if (!csv_text || !supplier_id) {
      return new Response(JSON.stringify({ error: "csv_text and supplier_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Use Lovable AI to parse unstructured text into structured product data
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    
    let products: ParsedProduct[] = [];

    if (lovableApiKey) {
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are an HVAC price list data extractor. Extract product data from the provided text.
Return a JSON array of objects with these fields:
- product_code: string (the product/model code)
- description: string (product description)
- category: string (product category like "Midwall Inverter", "Cassette Inverter", "Duct Inverter", etc.)
- pipe_size: string or null (pipe sizes like "1/4 3/8", "3/8 5/8")
- cost_price: number (price as a number, 0 if not available)
- is_price_on_request: boolean (true if price shows POR or similar)

Only return the JSON array, no other text. Parse South African Rand prices (R 7 700,00 = 7700.00).
Supplier name for context: ${supplier_name || "Unknown"}`
            },
            {
              role: "user",
              content: csv_text.substring(0, 15000),
            }
          ],
          temperature: 0.1,
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content || "";
        // Extract JSON from response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            products = JSON.parse(jsonMatch[0]);
          } catch {
            console.error("Failed to parse AI JSON response");
          }
        }
      }
    }

    if (products.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not parse products from the provided text. Try CSV format instead.", products: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract BTU and refrigerant info from descriptions
    const enrichedProducts = products.map((p) => {
      const btuMatch = p.description.match(/(\d+)\s*(?:000)?\s*BTU/i);
      let btu: number | null = btuMatch ? parseInt(btuMatch[1]) : null;
      if (btu && btu < 1000) btu = btu * 1000;
      // Sanitize btu_rating from AI - strip non-numeric chars
      const rawBtu = p.cost_price != null ? btu : null;
      const sanitizedBtu = rawBtu != null ? (isNaN(rawBtu) ? null : Math.round(rawBtu)) : null;

      const refrigerant = p.description.match(/R32|R410A|R22/i)?.[0]?.toUpperCase() || null;

      return {
        supplier_id,
        product_code: p.product_code,
        description: p.description,
        category: p.category,
        pipe_size: p.pipe_size || null,
        cost_price: p.cost_price || 0,
        is_price_on_request: p.is_price_on_request || false,
        btu_rating: sanitizedBtu,
        refrigerant_type: refrigerant,
        default_markup_percent: 30,
      };
    });

    // Upsert products (match on supplier_id + product_code)
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const product of enrichedProducts) {
      const { data: existing } = await supabase
        .from("supplier_products")
        .select("id")
        .eq("supplier_id", product.supplier_id)
        .eq("product_code", product.product_code)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("supplier_products")
          .update({
            description: product.description,
            category: product.category,
            pipe_size: product.pipe_size,
            cost_price: product.cost_price,
            is_price_on_request: product.is_price_on_request,
            btu_rating: product.btu_rating,
            refrigerant_type: product.refrigerant_type,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) { skipped++; } else { updated++; }
      } else {
        const { error } = await supabase.from("supplier_products").insert(product);
        if (error) { skipped++; } else { imported++; }
      }
    }

    return new Response(
      JSON.stringify({ success: true, imported, updated, skipped, total: enrichedProducts.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Parse price list error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
