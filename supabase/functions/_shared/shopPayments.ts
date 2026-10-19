/**
 * Online shop payment switch (2026-10-19). Checkout ships OFF: it only creates orders and Yoco checkouts when
 * SHOP_PAYMENTS_ENABLED is exactly "true" AND the Yoco keys for YOCO_ENVIRONMENT are present and match.
 * Otherwise the website shows "Checkout coming soon, talk to Sam" and nothing is created.
 */
import { getYocoConfig } from "./yoco.ts";

export function shopCheckoutEnabled(): boolean {
  if ((Deno.env.get("SHOP_PAYMENTS_ENABLED") || "").trim() !== "true") return false;
  try {
    getYocoConfig();
    return true;
  } catch {
    return false;
  }
}

/** payments.environment / shop_orders.environment use 'sandbox' | 'live' (DB check); Yoco config says 'test' | 'live'. */
export function dbEnvironment(yocoEnv: string): "sandbox" | "live" {
  return yocoEnv === "live" ? "live" : "sandbox";
}
