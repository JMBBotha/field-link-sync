import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleRequest } from "./index.ts";

Deno.test("hello returns success response", async () => {
  const req = new Request("http://localhost/functions/v1/hello", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Lovable" }),
  });

  const res = await handleRequest(req);
  const json = await res.json();

  assertEquals(res.status, 200);
  assertEquals(json.success, true);
  assertEquals(json.message, "Hello from Lovable Edge Functions");
  assertEquals(json.echoed.name, "Lovable");
});

Deno.test("hello handles CORS preflight", async () => {
  const req = new Request("http://localhost/functions/v1/hello", { method: "OPTIONS" });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});
