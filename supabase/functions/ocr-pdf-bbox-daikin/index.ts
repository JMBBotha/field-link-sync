// Daikin OCR — processes ONE page per invocation to stay under 150s timeout.
// Call repeatedly with ?page=1, ?page=2, ... up to total pages.
// Populates supplier_products.row_bbox / price_bbox / page_number for matching SKUs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are extracting product row coordinates from ONE page of a Daikin price-list PDF.

The target price column is labelled "INSTALLER PRICE" in the table header.
It is typically the FIRST price column (to the LEFT of "INCL. CORROSION TREATMENT - PARTIAL" and "INCL. CORROSION TREATMENT - FULL").
NEVER use the corrosion-treatment columns. NEVER use RRP or Campaign columns.

For EACH product row that has a price in the INSTALLER PRICE column, return:
- product_code: exact SKU as printed (e.g. "FTXF25F", "FFA25A9 + FFA50A9", "FFA25A9 (x2)")
- price_value: the numeric INSTALLER PRICE value as a NUMBER, with no "R", no spaces, no commas (e.g. 8991, 15446, 37615)
- row_bbox: {x, y, width, height} normalized 0-1, tightly wrapping ONLY that single product row (height ~1-3% of page)
- price_bbox: {x, y, width, height, center_x} normalized 0-1, tightly wrapping the INSTALLER PRICE numeric value only.

CRITICAL:
- One entry per product row. NEVER merge rows.
- SKIP section headers, totals, footers, dates, page titles, and any row without an INSTALLER PRICE value.
- If you cannot determine a tight bbox, OMIT that row.

Return JSON: {"products":[{product_code, price_value, row_bbox, price_bbox}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const pageNum = parseInt(url.searchParams.get("page") || "1", 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) {
      return new Response(JSON.stringify({ error: "Invalid page number" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");

    const { data: supplier } = await supabase
      .from("suppliers")
      .select("id, name")
      .ilike("name", "%daikin%")
      .limit(1).single();
    if (!supplier) throw new Error("Daikin supplier not found");

    // Find the most recent PDF stored in the supplier-pdfs bucket for this supplier
    const { data: storageFiles } = await supabase.storage
      .from("supplier-pdfs")
      .list(supplier.id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
    const newestPdf = storageFiles?.find((f) => /\.pdf$/i.test(f.name));
    if (!newestPdf) throw new Error("No Daikin PDF found in supplier-pdfs storage");
    const { data: signed } = await supabase.storage
      .from("supplier-pdfs")
      .createSignedUrl(`${supplier.id}/${newestPdf.name}`, 600);
    const pdfUrl = signed?.signedUrl;
    if (!pdfUrl) throw new Error("Could not sign Daikin PDF URL");
    console.log(`[ocr-daikin] Using PDF: ${newestPdf.name}`);

    // Download full PDF, extract just the requested page to keep payload small
    const pdfResp = await fetch(pdfUrl);
    if (!pdfResp.ok) throw new Error(`PDF download failed: ${pdfResp.status}`);
    const fullPdfBytes = new Uint8Array(await pdfResp.arrayBuffer());

    const srcDoc = await PDFDocument.load(fullPdfBytes);
    const totalPages = srcDoc.getPageCount();
    if (pageNum > totalPages) {
      return new Response(JSON.stringify({
        success: true, done: true, total_pages: totalPages, message: "All pages processed",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const singleDoc = await PDFDocument.create();
    const [copied] = await singleDoc.copyPages(srcDoc, [pageNum - 1]);
    singleDoc.addPage(copied);
    const singleBytes = await singleDoc.save();

    let bin = "";
    const chunkSize = 8192;
    for (let i = 0; i < singleBytes.length; i += chunkSize) {
      bin += String.fromCharCode(...singleBytes.subarray(i, i + chunkSize));
    }
    const base64Pdf = btoa(bin);

    console.log(`[ocr-daikin] Page ${pageNum}/${totalPages}, size ${(singleBytes.length / 1024).toFixed(0)}KB`);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Extract INSTALLER PRICE rows from page ${pageNum} with bbox coordinates.` },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
            ],
          },
        ],
        temperature: 0.0,
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("[ocr-daikin] AI error:", aiResp.status, txt.substring(0, 300));
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit — wait and retry" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Lovable AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway returned ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let parsed: any = {};
    try {
      parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* skip */ } }
    }
    const products: any[] = parsed.products || [];
    console.log(`[ocr-daikin] Page ${pageNum}: AI returned ${products.length} products`);
    if (products.length > 0) {
      console.log(`[ocr-daikin] Page ${pageNum} sample:`, JSON.stringify(products.slice(0, 3)));
    }

    const skipReasons: Record<string, number> = {};
    let updated = 0, skipped = 0;
    for (const p of products) {
      if (!p.product_code || !p.row_bbox || !p.price_bbox) {
        skipReasons["missing_fields"] = (skipReasons["missing_fields"] || 0) + 1;
        skipped++; continue;
      }
      const pb = p.price_bbox;
      if (typeof pb.x !== "number" || typeof pb.width !== "number") {
        skipReasons["bad_bbox_types"] = (skipReasons["bad_bbox_types"] || 0) + 1;
        skipped++; continue;
      }
      // Daikin installer price column is not necessarily the rightmost column on the page — rightmost-column heuristic does not apply here.

      // Build candidate SKU list from AI-returned code
      // Handles: "FBA35A9 (x2)", "FBA35A9 + FBA50A9", "FFA25A9 + FFA35A9\n+ FFA50A9"
      const raw = String(p.product_code).replace(/\s+/g, " ").trim();
      const cleaned = raw.replace(/\(x\d+\)/gi, "").trim();
      const tokens = cleaned.split(/\s*\+\s*/).map((t) => t.trim()).filter(Boolean);
      const candidates = Array.from(new Set([raw, cleaned, ...tokens])).filter(Boolean);

      // PDF price lists are always EXCL VAT already — store the printed INSTALLER PRICE
      // value directly in supplier_products.cost_price, no VAT conversion.
      const priceExclVat = Number(p.price_value);
      const updatePayload: Record<string, unknown> = {
        row_bbox: p.row_bbox,
        price_bbox: p.price_bbox,
        page_number: pageNum,
      };
      if (Number.isFinite(priceExclVat) && priceExclVat > 0) {
        updatePayload.cost_price = Math.round(priceExclVat * 100) / 100;
      }

      // Try exact match first across all candidates, then ilike fallback for first token
      const { error, count } = await supabase
        .from("supplier_products")
        .update(updatePayload, { count: "exact" })
        .eq("supplier_id", supplier.id)
        .in("product_code", candidates);

      let didUpdate = !!(count && count > 0);

      if (!didUpdate && tokens[0]) {
        const { count: c2 } = await supabase
          .from("supplier_products")
          .update(updatePayload, { count: "exact" })
          .eq("supplier_id", supplier.id)
          .ilike("product_code", `${tokens[0]}%`);
        if (c2 && c2 > 0) didUpdate = true;
      }

      if (error) {
        console.warn(`[ocr-daikin] ${raw}: ${error.message}`);
        skipReasons["update_error"] = (skipReasons["update_error"] || 0) + 1;
        skipped++;
      } else if (didUpdate) {
        updated++;
      } else {
        skipReasons["no_db_match"] = (skipReasons["no_db_match"] || 0) + 1;
        skipped++;
      }
    }

    const nextPage = pageNum + 1;
    const done = nextPage > totalPages;

    return new Response(JSON.stringify({
      success: true,
      page: pageNum,
      total_pages: totalPages,
      ai_returned: products.length,
      updated,
      skipped,
      skip_reasons: skipReasons,
      done,
      next_page: done ? null : nextPage,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[ocr-daikin] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
