import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authCorsHeaders, requireUser } from "../_shared/auth.ts";

/**
 * debug-customer-search
 *
 * Small admin-only diagnostic endpoint that exercises the two customer
 * lookup RPCs (search_customers, check_customer_duplicates) and reports
 * whether they still resolve the correct address column after the
 * address_line1 -> primary_address_line1 rename.
 *
 * It never returns customer PII — only column names, row counts and the
 * raw Postgres error (if any), so it is safe to call from tooling.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...authCorsHeaders, "Content-Type": "application/json" },
  });

const ADDRESS_COLUMN = "primary_address_line1";
const STALE_COLUMN = "address_line1";

type Check = {
  rpc: string;
  ok: boolean;
  rowCount: number;
  columns: string[];
  hasAddressColumn: boolean;
  referencesStaleColumn: boolean;
  error: string | null;
};

function inspect(rpc: string, data: unknown, error: { message: string } | null): Check {
  const rows = Array.isArray(data) ? data : [];
  const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
  const message = error?.message ?? null;
  return {
    rpc,
    ok: !error,
    rowCount: rows.length,
    columns,
    hasAddressColumn: columns.includes(ADDRESS_COLUMN),
    // A stale definition surfaces either as a bad column in the error text
    // or as an unexpected column name in the result set.
    referencesStaleColumn:
      (message?.includes(STALE_COLUMN) ?? false) || columns.includes(STALE_COLUMN),
    error: message,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: authCorsHeaders });

  const auth = await requireUser(req, ["admin", "dispatcher"]);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const term = url.searchParams.get("term") ?? "a";

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const [search, duplicates] = await Promise.all([
    db.rpc("search_customers", { search_term: term, max_results: 5 }),
    db.rpc("check_customer_duplicates", {
      p_phone: url.searchParams.get("phone"),
      p_email: url.searchParams.get("email"),
      p_first_name: url.searchParams.get("first_name") ?? term,
      p_last_name: url.searchParams.get("last_name"),
      p_address: url.searchParams.get("address"),
    }),
  ]);

  const checks = [
    inspect("search_customers", search.data, search.error),
    inspect("check_customer_duplicates", duplicates.data, duplicates.error),
  ];

  const healthy = checks.every((c) => c.ok && !c.referencesStaleColumn);

  return json(
    {
      healthy,
      addressColumn: ADDRESS_COLUMN,
      term,
      checks,
    },
    healthy ? 200 : 500,
  );
});
