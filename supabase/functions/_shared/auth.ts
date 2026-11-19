import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const authCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const adminClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

const deny = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...authCorsHeaders, "Content-Type": "application/json" },
  });

const WRITE_ROLES = ["admin", "dispatcher", "field_agent", "platform_super_admin", "platform_ops"];

/** True when the only relevant role is viewer. Combined with a write role, the person is not read-only. */
export function isReadonlyViewerRoles(roles: string[]): boolean {
  return roles.includes("viewer") && !roles.some((role) => WRITE_ROLES.includes(role));
}

const VIEW_ONLY = "This login is view-only. It cannot change or send anything.";

/**
 * Deny a user JWT that belongs to a read-only viewer.
 * Service-role calls and non-user tokens (webhooks) are left to their own checks.
 */
export async function rejectViewerJwt(req: Request): Promise<Response | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return null;
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return null;
  const { data: roleRows } = await db.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((row: { role: string }) => row.role);
  if (isReadonlyViewerRoles(roles)) return deny(VIEW_ONLY, 403);
  return null;
}

export type AuthResult =
  | { ok: true; userId: string | null; roles: string[] }
  | { ok: false; response: Response };

/**
 * Verifies the caller's JWT. When `roles` is provided the caller must hold at
 * least one of them in public.user_roles. Trusted server-to-server calls that
 * present the service-role key are allowed through.
 */
export async function requireUser(
  req: Request,
  roles?: string[],
): Promise<AuthResult> {
  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) return { ok: false, response: deny("Not authenticated", 401) };
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return { ok: true, userId: null, roles: [] };
  }

  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return { ok: false, response: deny("Not authenticated", 401) };

  const { data: roleRows } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const userRoles = (roleRows ?? []).map((r: { role: string }) => r.role);

  if (isReadonlyViewerRoles(userRoles)) {
    return { ok: false, response: deny(VIEW_ONLY, 403) };
  }

  if (roles?.length && !userRoles.some((r) => roles.includes(r))) {
    return { ok: false, response: deny("Insufficient permissions", 403) };
  }

  return { ok: true, userId, roles: userRoles };
}
