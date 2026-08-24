import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/debug-customer-search`;

// Optional: a staff JWT lets the test assert the RPC results themselves.
const STAFF_JWT = Deno.env.get("TEST_STAFF_JWT");

Deno.test("debug-customer-search rejects unauthenticated callers", async () => {
  const res = await fetch(FUNCTION_URL, {
    headers: { apikey: SUPABASE_ANON_KEY },
  });
  await res.text();
  assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

Deno.test({
  name: "customer search RPCs return the renamed address column",
  ignore: !STAFF_JWT,
  fn: async () => {
    const res = await fetch(`${FUNCTION_URL}?term=a`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${STAFF_JWT}`,
      },
    });
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body.healthy, true);
    assertEquals(body.addressColumn, "primary_address_line1");

    for (const check of body.checks) {
      assertEquals(check.error, null, `${check.rpc} errored: ${check.error}`);
      assertEquals(
        check.referencesStaleColumn,
        false,
        `${check.rpc} still references address_line1`,
      );
      // Columns are only observable when the RPC returned at least one row.
      if (check.rowCount > 0) {
        assert(
          check.hasAddressColumn,
          `${check.rpc} did not expose primary_address_line1`,
        );
      }
    }
  },
});
