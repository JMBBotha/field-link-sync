import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("hello returns success response", async () => {
  const req = new Request("http://localhost/functions/v1/hello", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Lovable" }),
  });

  const res = await fetch(req);
  const json = await res.json();

  assertEquals(res.status, 200);
  assertEquals(json.success, true);
  assertEquals(json.echoed.name, "Lovable");
});
