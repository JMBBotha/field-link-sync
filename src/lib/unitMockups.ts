import { supabase } from "@/integrations/supabase/client";
import { unitLineModelKey } from "@/lib/unitCards";

export type MockupUnit = { modelKey: string; label: string; url: string | null; own: boolean };

/** Units on the lead's latest quote, each with its picture for photo mockups: own uploaded cut-out first, else the approved catalogue photo. */
export async function loadLeadMockupUnits(leadId: string): Promise<MockupUnit[]> {
  const { data: q } = await (supabase.from("quotes") as any).select("id").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!q) return [];
  const { data: items } = await (supabase.from("quote_items") as any).select("item_name, item_type, item_number, product_code, is_bundle, metadata").eq("quote_id", q.id);
  const names = new Map<string, string>();
  for (const it of (items || []) as any[]) { const k = unitLineModelKey(it); if (k && !names.has(k)) names.set(k, String(it.item_name || k)); }
  const keys = [...names.keys()];
  if (!keys.length) return [];
  const [{ data: media }, { data: own }] = await Promise.all([
    (supabase.from("product_media" as never) as any).select("model_key, display_name, image_url, status").in("model_key", keys),
    (supabase.from("unit_mockups") as any).select("model_key, image_url").in("model_key", keys),
  ]);
  const m = new Map(((media || []) as any[]).map((x) => [x.model_key, x]));
  const o = new Map(((own || []) as any[]).map((x) => [x.model_key, x.image_url as string]));
  return keys.map((k) => {
    const pm = m.get(k);
    const ownUrl = o.get(k) ?? null;
    const cat = pm?.status === "approved" ? (pm.image_url as string | null) : null;
    return { modelKey: k, label: String(pm?.display_name || names.get(k)).slice(0, 40), url: ownUrl || cat, own: !!ownUrl };
  });
}

/** Removes a plain light background (white/near-white, connected to the edges) so the unit sits naturally on a wall photo. */
export async function cutOutUnit(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h); const px = d.data;
  const alreadyTransparent = (() => { for (let i = 3; i < px.length; i += 400) if (px[i] < 250) return true; return false; })();
  if (!alreadyTransparent) {
    const light = (i: number) => px[i] > 225 && px[i + 1] > 225 && px[i + 2] > 225;
    const seen = new Uint8Array(w * h); const stack: number[] = [];
    for (let x = 0; x < w; x++) stack.push(x, x + (h - 1) * w);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p] || !light(p * 4)) continue;
      seen[p] = 1; px[p * 4 + 3] = 0;
      const x = p % w;
      if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
      if (p >= w) stack.push(p - w); if (p < w * (h - 1)) stack.push(p + w);
    }
    ctx.putImageData(d, 0, 0);
  }
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not process the picture"))), "image/png"));
}

/** Uploads a unit picture as this company's mockup cut-out for that model (reused on every photo/quote). */
export async function saveUnitMockup(modelKey: string, label: string, file: File): Promise<string> {
  const { data: cid, error: cErr } = await (supabase.rpc as any)("caller_company_id");
  if (cErr || !cid) throw new Error("Couldn't work out your company");
  const blob = await cutOutUnit(file);
  const path = `mockups/${cid}/${modelKey.replace(/[^a-z0-9_-]/gi, "_")}-${Date.now()}.png`;
  const up = await supabase.storage.from("product-media").upload(path, blob, { contentType: "image/png", upsert: true });
  if (up.error) throw up.error;
  const url = supabase.storage.from("product-media").getPublicUrl(path).data.publicUrl;
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await (supabase.from("unit_mockups") as any).upsert(
    { company_id: cid, model_key: modelKey, label, image_url: url, storage_path: path, created_by: user?.id ?? null, updated_at: new Date().toISOString() },
    { onConflict: "company_id,model_key" },
  );
  if (error) throw error;
  return url;
}
