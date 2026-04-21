// Daikin OCR — processes ONE page per invocation to stay under 150s timeout.
// Call repeatedly with ?page=1, ?page=2, ... up to total pages.
// Populates supplier_products.row_bbox / price_bbox / page_number for matching SKUs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are extracting product row coordinates from ONE page of a Daikin scanned price-list PDF.

For EACH product row that has a price in the WEBSHOP PRICE column (NOT RRP, NOT Campaign), return:
- product_code: exact SKU as printed (e.g. "FTXF25F", "RXF25E", "FTXM25R")
- row_bbox: {x, y, width, height} normalized 0-1, tightly wrapping ONLY that single product row (height ~1-3% of page)
- price_bbox: {x, y, width, height, center_x} normalized 0-1, tightly wrapping the WEBSHOP PRICE numeric value only.
  center_x MUST be > 0.7 (rightmost column rule).

CRITICAL:
- One entry per product row. NEVER merge rows.
- SKIP section headers, totals, RRP-only rows, footers, dates, page titles.
- If you cannot determine a tight bbox, OMIT that row.

Return JSON: {"products":[{product_code, row_bbox, price_bbox}]}`;

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

    const { data: pages } = await supabase
      .from("supplier_pdf_pages")
      .select("pdf_storage_path")
      .ilike("supplier_id", "%daikin%")
      .order("page_number")
      .limit(1);
    const pdfUrl = pages?.[0]?.pdf_storage_path;
    if (!pdfUrl) throw new Error("Daikin PDF URL not found");

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
              { type: "text", text: `Extract WEBSHOP PRICE rows from page ${pageNum} with bbox coordinates.` },
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
      if (pb.x + pb.width < 0.7) {
        skipReasons["not_rightmost"] = (skipReasons["not_rightmost"] || 0) + 1;
        skipped++; continue;
      }

      const { error, count } = await supabase
        .from("supplier_products")
        .update({
          row_bbox: p.row_bbox,
          price_bbox: p.price_bbox,
          page_number: pageNum,
        }, { count: "exact" })
        .eq("supplier_id", supplier.id)
        .eq("product_code", p.product_code);

      if (error) { console.warn(`[ocr-daikin] ${p.product_code}: ${error.message}`); skipped++; }
      else if (count && count > 0) { updated++; }
      else { skipped++; }
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
