/**
 * Public lead-intake endpoints must not let an anonymous caller choose which
 * tenant a lead lands in. A caller-supplied company_id is only honoured when
 * the request presents a trusted server secret (LEAD_INTAKE_SECRET) or the
 * service-role key; otherwise it is ignored and the company is resolved from
 * matched customer data / the default company instead.
 */
export function trustedCompanyId(req: Request, bodyCompanyId: unknown): string | null {
  if (typeof bodyCompanyId !== "string" || !bodyCompanyId) return null;

  const secret = Deno.env.get("LEAD_INTAKE_SECRET");
  const provided = req.headers.get("x-api-key")?.trim() ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const trusted = (!!secret && provided === secret) ||
    (!!serviceKey && (bearer === serviceKey || provided === serviceKey));

  if (!trusted) {
    console.warn("[lead-intake] Ignoring caller-supplied company_id from untrusted request");
    return null;
  }
  return bodyCompanyId;
}
