# Website + shop releases, 19 Oct 2026 (approved by Johan 06:26 SAST: "Fix the leak now, then build the website with your recommended defaults")

| Release | Commit | DB applied live | Rollback |
|---|---|---|---|
| Leak fix: booking_clashes / open_double_bookings no longer callable by anon/PUBLIC | 2ae4f25a | yes | docs/db-releases/2026-10-19_booking_clash_revoke_anon_rollback.sql |
| R-A lead intake (CORS allow-list, honeypot, rate limit, form tag, lane fix, preferred date = request, email only) | 1afab343 | yes (lead_source += website_shop, website_rate_limits, fl_website_rate_hit) | git revert 1afab343 + 2026-10-19_website_intake_hardening_rollback.sql (enum value stays) |
| R-B shop pricing (shop_tier_map, fl_shop_price_list/quote, shop-prices, terms 12.5 paid-in-full, Settings > Billing "Shop models") | dbd00a9f | yes | git revert dbd00a9f + 2026-10-19_shop_tier_map_prices_rollback.sql |
| R-C checkout, live payments OFF (shop_orders, fl_shop_finalize, shop-checkout, yoco-webhook shop branch, Yoco method/env fix) | 52e3a441 | yes | git revert 52e3a441 + 2026-10-19_shop_orders_checkout_rollback.sql, then 2026-10-19_get_public_quote_before_shop.sql |
| Copy fix: price list "free site visit" removed | this commit | yes | 2026-10-19_shop_price_list_copy_rollback.sql |

## Not live yet: edge functions
GitHub -> Lovable sync does not redeploy edge functions. Live today: the OLD receive-website-lead (CORS *, WhatsApp
confirmation, writes scheduled_date) and the OLD yoco-webhook / yoco-create-payment. shop-prices and shop-checkout return 404.
Needed: one edge-function deploy of receive-website-lead, shop-prices, shop-checkout, yoco-webhook, yoco-create-payment.

## Switching payments on later (Johan)
Secrets: YOCO_ENVIRONMENT (test|live), YOCO_TEST_SECRET_KEY / YOCO_LIVE_SECRET_KEY, YOCO_TEST_WEBHOOK_SECRET / YOCO_LIVE_WEBHOOK_SECRET,
then SHOP_PAYMENTS_ENABLED=true. Register the Yoco webhook to .../functions/v1/yoco-webhook. Until then checkout answers
"Checkout coming soon, talk to Sam" and creates nothing.

## Verified
- Dry run (rolled back, number generators stubbed): 2 rooms R42,728 -> quote total 42,728 = order, invoice paid (1 invoice),
  job scheduled/no date/site check, lead website_shop converted, replay is a no-op, public quote shows website_shop.
- deno check + deno tests (11), tsc clean, vitest 1381 pass / 2 known failures (pdfViewerMobile, techCompanyMoney).

## Open points for Johan
- Terms 2.1 still says a 70% deposit for installs; shop orders are paid in full (only 12.5 was changed, as approved).
- Shop orders put Johan as owner/sales person (lead assignee, quote creator, job creator): commission snapshot follows that.
