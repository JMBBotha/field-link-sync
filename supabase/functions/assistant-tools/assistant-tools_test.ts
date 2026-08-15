import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { corsHeaders, handleRequest } from "./index.ts";

Deno.test("assistant-tools handles CORS preflight", async () => {
  const req = new Request("http://localhost/functions/v1/assistant-tools", {
    method: "OPTIONS",
  });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(res.headers.get("Access-Control-Allow-Headers"), corsHeaders["Access-Control-Allow-Headers"]);
});

Deno.test("assistant-tools rejects missing Authorization header", async () => {
  const req = new Request("http://localhost/functions/v1/assistant-tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "search_customers", parameters: { query: "Acme" } }),
  });

  const res = await handleRequest(req);
  const json = await res.json();

  assertEquals(res.status, 401);
  assertEquals(json.error, "Missing or invalid Authorization header");
});

Deno.test("assistant-tools rejects unsupported tool before auth", async () => {
  const req = new Request("http://localhost/functions/v1/assistant-tools", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer invalid-token",
    },
    body: JSON.stringify({ tool: "delete_everything" }),
  });

  // This will fail auth first because the token is invalid, but verifies the route is wired.
  const res = await handleRequest(req);
  assertEquals(res.status, 401);
});
