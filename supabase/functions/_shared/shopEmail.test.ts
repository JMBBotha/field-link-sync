import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shopPaidEmail } from "./shopEmail.ts";

Deno.test("shop paid email: totals, escaping, refund wording, no booking promise", () => {
  const { subject, html } = shopPaidEmail({
    order_ref: "WEB-261019-ABCDE", first_name: "<b>Ann</b>", total_incl: 42728, invoice_number: "INV-1", quote_token: "tok",
    lines: [{ label: "Lounge", size: "XL", room_incl: 28329, unit: { name: "Samsung AR6500" }, isolator: { ex: 2200 } }],
  });
  assertStringIncludes(subject, "WEB-261019-ABCDE");
  assertStringIncludes(html, "R 42 728.00");
  assertStringIncludes(html, "&lt;b&gt;Ann");
  assertStringIncludes(html, "refund your payment in full");
  assertStringIncludes(html, "isn't booked until we confirm");
  assertStringIncludes(html, "/quote/tok");
  assert(!html.includes("0800 232 665"));
});
