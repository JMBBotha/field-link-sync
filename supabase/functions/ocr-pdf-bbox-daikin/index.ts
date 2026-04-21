// Daikin-only OCR overlay generator.
// Reads the Daikin scanned PDF, asks Gemini Vision to return per-product bbox coordinates,
// and UPDATEs supplier_products.row_bbox / price_bbox / page_number on the existing 199 rows.
// Does NOT touch any other supplier and does NOT modify the locked PDF extractor.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a precise PDF coordinate extractor for a Daikin scanned price-list PDF.

For EACH product row that has a price in the WEBSHOP PRICE column (the second-from-left numeric column, NOT RRP, NOT WEBSHOP CAMPAIGN PRICE), return:
- product_code: exact SKU (e.g. "FTXF25F", "RXF25E")
- page_number: integer (1-indexed)
- row_bbox: {x, y, width, height} normalized 0-1, tightly wrapping ONLY that single product row (height ~1-3% of page)
- price_bbox: {x, y, width, height, center_x} normalized 0-1, tightly wrapping the WEBSHOP PRICE numeric value only. center_x must be > 0.7 (rightmost column rule).

CRITICAL:
- One entry per product row. NEVER merge rows.
- SKIP section headers, totals, RRP-only rows, footers, dates.
- If you cannot determine a tight bbox for a row, OMIT that row — do NOT guess.
- Use the WEBSHOP PRICE column, not RRP, not Campaign.

Return JSON: {"products":[{product_code, page_number, row_bbox, price_bbox}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");

    // 1. Find Daikin supplier and PDF URL
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("id, name")
      .ilike("name", "%daikin%")
      .limit(1)
      .single();
    if (!supplier) throw new Error("Daikin supplier not found");

    const { data: pages } = await supabase
      .from("supplier_pdf_pages")
      .select("pdf_storage_path, pdf_filename")
      .ilike("supplier_id", "%daikin%")
      .order("page_number")
      .limit(1);
    const pdfUrl = pages?.[0]?.pdf_storage_path;
    if (!pdfUrl) throw new Error("Daikin PDF URL not found");

    console.log("[ocr-daikin] Fetching PDF:", pdfUrl);

    // 2. Download PDF and base64-encode
    const pdfResp = await fetch(pdfUrl);
    if (!pdfResp.ok) throw new Error(`PDF download failed: ${pdfResp.status}`);
    const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());

    // Chunked base64 to avoid stack overflow on large PDFs
    let base64 = "";
    const chunkSize = 8192;
    for (let i = 0; i < pdfBytes.length; i += chunkSize) {
      base64 += String.fromCharCode(...pdfBytes.subarray(i, i + chunkSize));
    }
    const base64Pdf = btoa(base64);

    console.log(`[ocr-daikin] PDF size: ${(pdfBytes.length / 1024).toFixed(0)}KB`);

    // 3. Send to Gemini 2.5 Pro Vision (handles PDFs natively)
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all WEBSHOP PRICE rows with bbox coordinates." },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
            ],
          },
        ],
        temperature: 0.0,
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("[ocr-daikin] AI error:", aiResp.status, txt.substring(0, 500));
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit — try again in a minute" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Lovable AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway returned ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const content = aiData.choices?.[0]?.message?.content || "";
    console.log("[ocr-daikin] AI response length:", content.length);

    // 4. Parse JSON from response
    let parsed: any = {};
    try {
      parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }
    const products: any[] = parsed.products || [];
    console.log("[ocr-daikin] Parsed products:", products.length);

    // 5. UPDATE supplier_products with bbox data — match on (supplier_id, product_code)
    let updated = 0;
    let skipped = 0;
    for (const p of products) {
      if (!p.product_code || !p.page_number || !p.row_bbox || !p.price_bbox) {
        skipped++;
        continue;
      }
      // Right-column gate (must match overlay system's filter)
      const pb = p.price_bbox;
      if (typeof pb.x !== "number" || typeof pb.width !== "number") {
        skipped++;
        continue;
      }
      if (pb.x + pb.width < 0.7) {
        skipped++;
        continue;
      }

      const { error } = await supabase
        .from("supplier_products")
        .update({
          row_bbox: p.row_bbox,
          price_bbox: p.price_bbox,
          page_number: p.page_number,
        })
        .eq("supplier_id", supplier.id)
        .eq("product_code", p.product_code);

      if (error) {
        console.warn(`[ocr-daikin] Update failed for ${p.product_code}:`, error.message);
        skipped++;
      } else {
        updated++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ai_returned: products.length,
        updated,
        skipped,
        supplier: supplier.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ocr-daikin] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
