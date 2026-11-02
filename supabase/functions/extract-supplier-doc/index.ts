// extract-supplier-doc — NOT DEPLOYED (needs Johan's OK).
// Input:  { lines: string[] }  text lines from the PDF text layer, already filtered in the browser.
// Output: { lines: DocLine[] } product lines only.
// POPIA: the server filters again with productLinesOnly() before anything is sent to the AI, and the AI's answer
// is cleaned with cleanExtracted(). No images, no headers, no customer blocks are ever sent. Admin only.
import { requireUser, authCorsHeaders } from "../_shared/auth.ts";
import { productLinesOnly, cleanExtracted } from "../_shared/supplierDocLines.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...authCorsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: authCorsHeaders });
  const auth = await requireUser(req, ["admin"]);
  if (!auth.ok) return auth.response;
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const raw: string[] = Array.isArray(body?.lines) ? body.lines.map((l: unknown) => String(l)).slice(0, 400) : [];
  const safe = productLinesOnly(raw);
  if (!safe.length) return json({ lines: [], sent: 0 });

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return json({ error: "AI not configured" }, 500);
  const prompt = `These are product rows from a supplier delivery note or invoice (one per line, columns separated by 2+ spaces).
Return JSON {"lines":[{"model_number":string,"description":string,"qty":number,"unit_price_excl":number|null}]}.
qty is the delivered/invoiced quantity. unit_price_excl is the unit price excluding VAT if shown, else null. Do not invent rows.
Rows:
${safe.join("\n")}`;
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } }),
  });
  if (!r.ok) return json({ error: `AI ${r.status}` }, 502);
  const data = await r.json();
  let parsed: unknown = null;
  try { parsed = JSON.parse(String(data?.choices?.[0]?.message?.content ?? "").replace(/^```(json)?|```$/g, "")); } catch { /* fallthrough */ }
  return json({ lines: cleanExtracted(parsed), sent: safe.length });
});
