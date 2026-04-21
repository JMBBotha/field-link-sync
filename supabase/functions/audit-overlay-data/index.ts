import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BboxFields { x: number; y: number; w: number; h: number; valid: boolean }

const normalizeBbox = (rb: any): BboxFields => {
  if (!rb || typeof rb !== "object") return { x: 0, y: 0, w: 0, h: 0, valid: false };
  const x = Number(rb.x ?? rb.x_pct ?? NaN);
  const y = Number(rb.y ?? rb.y_pct ?? NaN);
  const w = Number(rb.width ?? rb.w ?? rb.w_pct ?? NaN);
  const h = Number(rb.height ?? rb.h ?? rb.h_pct ?? NaN);
  const finite = [x, y, w, h].every((v) => Number.isFinite(v));
  const inRange = finite && x >= 0 && x <= 1 && y >= 0 && y <= 1 && w > 0 && w <= 1 && h > 0 && h <= 1;
  return { x, y, w, h, valid: inRange };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Determine trigger source
  let triggeredBy = "cron";
  try {
    const body = await req.json();
    if (body?.triggered_by) triggeredBy = String(body.triggered_by);
  } catch { /* no body */ }

  // 1. Load enabled supplier names
  const { data: cfg, error: cfgErr } = await supabase
    .from("overlay_audit_config")
    .select("supplier_name")
    .eq("enabled", true);
  if (cfgErr) {
    return new Response(JSON.stringify({ error: cfgErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supplierNames = (cfg || []).map((c: any) => c.supplier_name);
  if (supplierNames.length === 0) {
    return new Response(JSON.stringify({ message: "No suppliers configured" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Resolve UUIDs
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .in("name", supplierNames);
  if (!suppliers || suppliers.length === 0) {
    return new Response(JSON.stringify({ message: "No matching suppliers found" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Create run record
  const { data: run, error: runErr } = await supabase
    .from("overlay_audit_runs")
    .insert({
      triggered_by: triggeredBy,
      suppliers_scanned: supplierNames,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr || !run) {
    return new Response(JSON.stringify({ error: runErr?.message || "Failed to create run" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const runId = run.id;

  let totalProducts = 0;
  const findings: any[] = [];

  try {
    for (const supplier of suppliers as any[]) {
      // Fetch valid pages for this supplier (text-based supplier_id column)
      const { data: pageRows } = await supabase
        .from("supplier_pdf_pages")
        .select("page_number, page_image_url")
        .or(`supplier_id.eq.${supplier.id},supplier_id.eq.${supplier.name}`);
      const validPages = new Set<number>(
        (pageRows || []).filter((p: any) => p.page_number != null).map((p: any) => Number(p.page_number)),
      );

      // Fetch all products for this supplier
      const { data: products, error: prodErr } = await supabase
        .from("supplier_products")
        .select("id, product_code, short_name, page_number, row_bbox")
        .eq("supplier_id", supplier.id);
      if (prodErr) throw new Error(`products fetch failed for ${supplier.name}: ${prodErr.message}`);

      const list = (products || []) as any[];
      totalProducts += list.length;

      for (const p of list) {
        const issues: { type: string; severity: string; details: string }[] = [];

        if (p.page_number == null) {
          issues.push({ type: "missing_page_number", severity: "error", details: "page_number is NULL" });
        } else if (validPages.size > 0 && !validPages.has(Number(p.page_number))) {
          issues.push({
            type: "page_not_in_pdf",
            severity: "error",
            details: `page_number=${p.page_number} not present in supplier_pdf_pages`,
          });
        }

        if (!p.row_bbox || typeof p.row_bbox !== "object") {
          issues.push({ type: "missing_row_bbox", severity: "error", details: "row_bbox is NULL or not an object" });
        } else {
          const norm = normalizeBbox(p.row_bbox);
          if (!norm.valid) {
            const reason = [norm.x, norm.y, norm.w, norm.h].some((v) => !Number.isFinite(v))
              ? "non-finite values"
              : "values outside [0..1] or zero size";
            issues.push({
              type: "invalid_bbox",
              severity: "error",
              details: `${reason}: x=${norm.x} y=${norm.y} w=${norm.w} h=${norm.h}`,
            });
          } else if (norm.h < 0.005 || norm.w < 0.05) {
            issues.push({
              type: "suspicious_bbox",
              severity: "warn",
              details: `unusually small region: w=${norm.w.toFixed(3)} h=${norm.h.toFixed(3)}`,
            });
          }
        }

        for (const issue of issues) {
          findings.push({
            run_id: runId,
            supplier_id: supplier.id,
            supplier_name: supplier.name,
            product_id: p.id,
            product_code: p.product_code,
            short_name: p.short_name,
            page_number: p.page_number,
            expected_page_number: validPages.size > 0 ? null : null,
            expected_bbox: null,
            actual_bbox: p.row_bbox,
            issue_type: issue.type,
            severity: issue.severity,
            details: issue.details,
          });
        }
      }
    }

    // Insert findings in chunks
    const chunkSize = 500;
    for (let i = 0; i < findings.length; i += chunkSize) {
      const chunk = findings.slice(i, i + chunkSize);
      const { error: insErr } = await supabase.from("overlay_audit_findings").insert(chunk);
      if (insErr) throw new Error(`findings insert failed: ${insErr.message}`);
    }

    await supabase.from("overlay_audit_runs").update({
      finished_at: new Date().toISOString(),
      total_products: totalProducts,
      total_findings: findings.length,
      status: "completed",
    }).eq("id", runId);

    return new Response(JSON.stringify({
      run_id: runId,
      suppliers_scanned: supplierNames,
      total_products: totalProducts,
      total_findings: findings.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    await supabase.from("overlay_audit_runs").update({
      finished_at: new Date().toISOString(),
      status: "failed",
      error: String(err?.message || err),
      total_products: totalProducts,
      total_findings: findings.length,
    }).eq("id", runId);

    return new Response(JSON.stringify({ error: String(err?.message || err), run_id: runId }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
