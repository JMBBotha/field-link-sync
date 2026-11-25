import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { primaryModelCode } from "../../../src/lib/modelCode.ts";
import {
  cutoutCandidateUrl,
  imageDataUrlFromGateway,
  isAlphaPng,
  isOwnProductImageUrl,
  lookupDecision,
  outboundProductText,
  parseDataImage,
  productImagePatch,
  productImagePath,
  productImagePublicUrl,
  rankImageCandidates,
  visionSaysMatch,
  type ImageCandidate,
  type ImageLinkState,
} from "../../../src/lib/productImageSearch.ts";

/**
 * Find one product photo, once, and link it to the catalogue row.
 *
 * Secrets (never hardcoded):
 * - XAI_API_KEY — existing. Web search used by lookup-ac-unit-specs. Preferred.
 * - PRODUCT_IMAGE_SEARCH_KEY — optional new secret. Brave Image Search token,
 *   used only when XAI_API_KEY is not set.
 * - LOVABLE_API_KEY — existing. Vision check and background removal via
 *   https://ai.gateway.lovable.dev (google/gemini-2.5-flash and
 *   google/gemini-2.5-flash-image). When it is missing, a matched photo is
 *   still stored and flagged for review; the background is not removed.
 *
 * POPIA: outbound calls receive the model code and brand only
 * (outboundProductText). Catalogue description is read locally to recognise
 * the model. Client names, sites, phones, quote numbers, and prices are not
 * selected and are not sent.
 *
 * Writes image_url, image_source_url, and image_needs_review only
 * (productImagePatch). Prices are never updated.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_COLUMNS = "id, product_code, model, brand, description, name, short_name, image_url, image_source_url, image_needs_review";
const MEDIA_COLUMNS = "model_key, image_url, image_source_url, image_status, fetch_error, fetched_at, needs_review, status";

const SEARCH_NOT_CONFIGURED =
  "Image search is not configured. Set the existing XAI_API_KEY, or set PRODUCT_IMAGE_SEARCH_KEY (a Brave Image Search token) if xAI is not available. Background removal uses the existing LOVABLE_API_KEY. Do not put keys in source code.";

const SEARCH_PROMPT = `You find a single official product photo of one air conditioner model.
Search the web. Prefer the manufacturer's own site and these suppliers: samsung.com, images.samsung.com, midea.com, mideaaircon.co.za, livance.co.za, fourwaysaircon.co.za, fourways.co.za, daikin.com, lg.com.
The photo must be THIS exact model. Reject a different capacity, a sibling model, a logo, or a room scene.
Reply with JSON only, no prose:
{"images":[{"url":"direct https image url ending in png jpg or webp when possible","page":"page url or null","model":"the exact model code printed on the page"}]}
If you cannot find that exact model, reply {"images":[]}.`;

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function modelFromProduct(product: { product_code?: string | null; model?: string | null; short_name?: string | null; name?: string | null; description?: string | null }): string | null {
  const direct = primaryModelCode(product.product_code) || primaryModelCode(product.model) || primaryModelCode(product.short_name) || primaryModelCode(product.name);
  if (direct) return direct;
  const found = String(product.description || "").toUpperCase().match(/\b[A-Z0-9][A-Z0-9/\-]{5,}\b/);
  return found ? primaryModelCode(found[0]) : null;
}

function extractImages(text: string): ImageCandidate[] {
  const raw = String(text || "").replace(/```json|```/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const list = Array.isArray(parsed?.images) ? parsed.images : [];
    return list.map((row: { url?: string; page?: string; model?: string; title?: string }) => ({
      url: String(row?.url || ""),
      page: row?.page || null,
      title: row?.title || null,
      model: row?.model || null,
    }));
  } catch {
    return [];
  }
}

async function searchWithXai(apiKey: string, text: string): Promise<ImageCandidate[]> {
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      model: "grok-4",
      input: [
        { role: "system", content: SEARCH_PROMPT },
        { role: "user", content: text },
      ],
      tools: [{ type: "web_search" }],
    }),
  });
  if (!res.ok) throw new Error(`image search ${res.status}`);
  const data = await res.json();
  const reply = data.output_text ?? data.output?.flatMap((item: { content?: { type?: string; text?: string }[] }) => item.content ?? []).find((part: { type?: string }) => part.type === "output_text")?.text;
  return extractImages(String(reply || ""));
}

async function searchWithBrave(apiKey: string, text: string): Promise<ImageCandidate[]> {
  const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(text + " air conditioner")}&count=8&safesearch=strict`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`image search ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows.map((row: { properties?: { url?: string }; thumbnail?: { src?: string }; url?: string; title?: string }) => ({
    url: String(row?.properties?.url || row?.thumbnail?.src || ""),
    page: row?.url || null,
    title: row?.title || null,
    model: null,
  }));
}

async function downloadImage(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const res = await fetch(cutoutCandidateUrl(url), {
    headers: { "User-Agent": "Mozilla/5.0 FieldLynk/1.0", Accept: "image/png,image/jpeg,image/webp" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(png|jpe?g|webp)$/.test(mime)) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 2000 || bytes.length > 8_000_000) return null;
  return { bytes, mime };
}

async function visionOk(apiKey: string, dataUrl: string, label: string): Promise<boolean> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Does this photo show the air conditioner ${label}? Reply with JSON only: {"match":true} or {"match":false}. False when it is a different model, a logo, a room, or a person.` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part: { text?: string }) => part?.text || "").join("") : "";
  return visionSaysMatch(text);
}

async function gatewayImage(apiKey: string, dataUrl: string, instruction: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(40000),
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      modalities: ["image", "text"],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) return null;
  const dataUrlOut = imageDataUrlFromGateway(await res.json());
  if (!dataUrlOut) return null;
  return parseDataImage(dataUrlOut);
}

function linkState(product: { image_url?: string | null; image_source_url?: string | null; image_needs_review?: boolean | null }, media: { image_url?: string | null; fetch_error?: string | null; needs_review?: boolean | null } | null): ImageLinkState {
  return {
    productImageUrl: product.image_url || null,
    mediaImageUrl: media?.image_url || null,
    sourceUrl: product.image_source_url || null,
    fetchError: media?.fetch_error || null,
    needsReview: product.image_needs_review === true || media?.needs_review === true,
  };
}

async function saveLinkedImage(
  db: ReturnType<typeof createClient>,
  productId: string,
  modelKey: string,
  brand: string | null,
  publicUrl: string,
  sourceUrl: string | null,
  imageStatus: "ready" | "needs_cutout",
  path: string,
) {
  const { error: productError } = await db.from("supplier_products").update(productImagePatch({
    image_url: publicUrl,
    image_source_url: sourceUrl,
    image_needs_review: true,
  })).eq("id", productId);
  if (productError) throw new Error(productError.message);
  const { data: existing } = await db.from("product_media").select("model_key").eq("model_key", modelKey).maybeSingle();
  const mediaPatch = {
    image_url: publicUrl,
    image_path: path,
    image_source_url: sourceUrl,
    image_status: imageStatus,
    source_label: (() => { try { return new URL(sourceUrl || publicUrl).hostname.replace(/^www\./, ""); } catch { return null; } })(),
    needs_review: true,
    fetch_error: null,
    fetched_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await db.from("product_media").update(mediaPatch).eq("model_key", modelKey);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("product_media").insert({
      ...mediaPatch,
      model_key: modelKey,
      model_code: modelKey,
      brand,
      status: "draft",
    });
    if (error) throw new Error(error.message);
  }
}

async function markImageAttempt(db: ReturnType<typeof createClient>, modelKey: string, brand: string | null, fetchError: string) {
  const patch = { fetch_error: fetchError.slice(0, 300), fetched_at: new Date().toISOString(), brand };
  const { data: existing } = await db.from("product_media").select("model_key").eq("model_key", modelKey).maybeSingle();
  if (existing) {
    await db.from("product_media").update(patch).eq("model_key", modelKey);
  } else {
    await db.from("product_media").insert({ ...patch, model_key: modelKey, model_code: modelKey, status: "draft" });
  }
}

async function handleProduct(db: ReturnType<typeof createClient>, productId: string, action: string, retry: boolean, replaceUrl: string | null) {
  const { data: product, error } = await db.from("supplier_products").select(PRODUCT_COLUMNS).eq("id", productId).maybeSingle();
  if (error) return { product_id: productId, status: "error", error: error.message };
  if (!product) return { product_id: productId, status: "not_found", reason: "no_product" };

  const modelKey = modelFromProduct(product);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";

  if (action === "reject") {
    const source = product.image_source_url || product.image_url || null;
    const { error: updateError } = await db.from("supplier_products").update(productImagePatch({
      image_url: null,
      image_needs_review: false,
      image_source_url: source,
    })).eq("id", productId);
    if (updateError) return { product_id: productId, status: "error", error: updateError.message };
    if (modelKey) await markImageAttempt(db, modelKey, product.brand || null, "image:rejected");
    if (modelKey) await db.from("product_media").update({ image_url: null, image_path: null, image_status: "none", needs_review: false }).eq("model_key", modelKey);
    return { product_id: productId, status: "rejected", needs_review: false, source_url: source };
  }

  if (action === "keep") {
    const { error: updateError } = await db.from("supplier_products").update(productImagePatch({ image_needs_review: false })).eq("id", productId);
    if (updateError) return { product_id: productId, status: "error", error: updateError.message };
    if (modelKey) await db.from("product_media").update({ needs_review: false }).eq("model_key", modelKey);
    return { product_id: productId, status: "linked", image_url: product.image_url, needs_review: false };
  }

  if (action === "replace") {
    if (!replaceUrl || !isOwnProductImageUrl(replaceUrl, supabaseUrl, productId)) {
      return { product_id: productId, status: "error", error: "Replace needs a photo already stored for this product." };
    }
    const { error: updateError } = await db.from("supplier_products").update(productImagePatch({
      image_url: replaceUrl,
      image_source_url: null,
      image_needs_review: false,
    })).eq("id", productId);
    if (updateError) return { product_id: productId, status: "error", error: updateError.message };
    if (modelKey) {
      const path = new URL(replaceUrl).pathname.split("/product-images/")[1] || productImagePath(productId);
      const { data: existing } = await db.from("product_media").select("model_key").eq("model_key", modelKey).maybeSingle();
      const mediaPatch = { image_url: replaceUrl, image_path: path, image_source_url: null, image_status: "ready", needs_review: false, fetch_error: null, fetched_at: new Date().toISOString() };
      if (existing) await db.from("product_media").update(mediaPatch).eq("model_key", modelKey);
      else await db.from("product_media").insert({ ...mediaPatch, model_key: modelKey, model_code: modelKey, brand: product.brand || null, status: "draft" });
    }
    return { product_id: productId, status: "linked", image_url: replaceUrl, needs_review: false };
  }

  if (!modelKey) return { product_id: productId, status: "not_found", reason: "no_model_code" };

  const { data: media } = await db.from("product_media").select(MEDIA_COLUMNS).eq("model_key", modelKey).maybeSingle();
  const state = linkState(product, media);
  const fetchingAt = media?.fetched_at ? new Date(media.fetched_at).getTime() : 0;
  const fetchIsFresh = Number.isFinite(fetchingAt) && Date.now() - fetchingAt < 120000;
  if (state.fetchError === "image:fetching" && !fetchIsFresh) state.fetchError = null;
  const decision = lookupDecision(state, { retry });
  if (decision.action === "return") {
    return { product_id: productId, status: "linked", reason: decision.reason, image_url: product.image_url, needs_review: product.image_needs_review === true, source_url: product.image_source_url };
  }
  if (decision.action === "link_existing" && media?.image_url) {
    const { error: updateError } = await db.from("supplier_products").update(productImagePatch({
      image_url: media.image_url,
      image_source_url: media.image_source_url || product.image_source_url || null,
      image_needs_review: media.needs_review === true,
    })).eq("id", productId);
    if (updateError) return { product_id: productId, status: "error", error: updateError.message };
    return { product_id: productId, status: "linked", reason: "already_linked", image_url: media.image_url, needs_review: media.needs_review === true, source_url: media.image_source_url };
  }
  if (decision.action === "skip") {
    return { product_id: productId, status: "skipped", reason: decision.reason, needs_review: false };
  }

  const label = outboundProductText(product.brand, modelKey);
  const xaiKey = Deno.env.get("XAI_API_KEY") || "";
  const braveKey = Deno.env.get("PRODUCT_IMAGE_SEARCH_KEY") || "";
  if (!xaiKey && !braveKey) {
    return { product_id: productId, status: "not_configured", error: SEARCH_NOT_CONFIGURED };
  }

  await markImageAttempt(db, modelKey, product.brand || null, "image:fetching");
  let candidates: ImageCandidate[] = [];
  try {
    if (xaiKey) candidates = await searchWithXai(xaiKey, label);
    if (!candidates.length && braveKey) candidates = await searchWithBrave(braveKey, label);
  } catch (err) {
    const message = err instanceof Error ? err.message : "image search failed";
    await markImageAttempt(db, modelKey, product.brand || null, `image:${message}`);
    return { product_id: productId, status: "error", error: message };
  }

  const ranked = rankImageCandidates(candidates, { modelCode: modelKey, brand: product.brand, excludeUrl: product.image_source_url });
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") || "";
  for (const candidate of ranked.slice(0, 3)) {
    const file = await downloadImage(candidate.url);
    if (!file) continue;
    const smallEnough = file.bytes.length <= 1_500_000;
    if (lovableKey && smallEnough) {
      const dataUrl = bytesToDataUrl(file.bytes, file.mime);
      const matched = await visionOk(lovableKey, dataUrl, label);
      if (!matched) continue;
      let stored = file;
      let background: "transparent" | "white" | "original" = "original";
      const transparent = await gatewayImage(lovableKey, dataUrl, "Remove the background. Keep this exact product only. Return a PNG with a transparent background. Do not add text, a logo, a shadow scene, or a different product.");
      if (transparent && isAlphaPng(transparent.bytes)) {
        stored = transparent;
        background = "transparent";
      } else {
        const white = await gatewayImage(lovableKey, dataUrl, "Place this exact product on a plain white background. Do not add text or change the product. Return the photo only.");
        if (white) {
          stored = white;
          background = "white";
        }
      }
      const ext = background === "transparent" || stored.mime === "image/png" ? "png" : stored.mime === "image/webp" ? "webp" : "jpg";
      const path = productImagePath(productId, ext);
      const upload = await db.storage.from("product-images").upload(path, stored.bytes, { contentType: stored.mime, upsert: true });
      if (upload.error) {
        await markImageAttempt(db, modelKey, product.brand || null, `image:${upload.error.message}`);
        return { product_id: productId, status: "error", error: upload.error.message };
      }
      const publicUrl = productImagePublicUrl(supabaseUrl, productId, ext);
      const source = candidate.page || candidate.url;
      await saveLinkedImage(db, productId, modelKey, product.brand || null, publicUrl, source, background === "transparent" ? "ready" : "needs_cutout", path);
      return { product_id: productId, status: "found", image_url: publicUrl, source_url: source, needs_review: true, background };
    }
    const ext = file.mime === "image/png" ? "png" : file.mime === "image/webp" ? "webp" : "jpg";
    const path = productImagePath(productId, ext);
    const upload = await db.storage.from("product-images").upload(path, file.bytes, { contentType: file.mime, upsert: true });
    if (upload.error) return { product_id: productId, status: "error", error: upload.error.message };
    const publicUrl = productImagePublicUrl(supabaseUrl, productId, ext);
    const source = candidate.page || candidate.url;
    await saveLinkedImage(db, productId, modelKey, product.brand || null, publicUrl, source, "needs_cutout", path);
    return {
      product_id: productId,
      status: "found",
      image_url: publicUrl,
      source_url: source,
      needs_review: true,
      background: "original",
      cutout: lovableKey ? "skipped" : "skipped",
      cutout_error: lovableKey ? "Photo was too large to cut out" : "LOVABLE_API_KEY not configured",
    };
  }

  await markImageAttempt(db, modelKey, product.brand || null, "image:no matching photo");
  return { product_id: productId, status: "not_found", reason: "no_match", needs_review: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "find");
    const retry = body?.retry === true;
    const replaceUrl = typeof body?.image_url === "string" ? body.image_url : null;
    const ids = [...new Set([...(Array.isArray(body?.product_ids) ? body.product_ids : []), body?.product_id].filter((id) => typeof id === "string" && UUID_RE.test(id)))].slice(0, 8);
    if (!ids.length) return json({ error: "product_id is required" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const results = [];
    for (const id of ids) results.push(await handleProduct(db, id, action, retry, replaceUrl));
    return json({ results, ...(results.length === 1 ? results[0] : {}) });
  } catch (err) {
    console.error("find-product-image", err instanceof Error ? err.message : err);
    return json({ error: err instanceof Error ? err.message : "Image lookup failed" }, 500);
  }
});
