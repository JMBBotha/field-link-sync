# Roadmap — catalog source of truth (equipment + materials)

## Owner-approved Option 1 (2026-10-08)
- [ ] Share solid Option 1 area card, rename chips, add row, tap-edit labour and creation control on estimate/Build quote; hide legacy tabs.
- [ ] Run suite once, fix only introduced failures, verify guarded desktop/tablet/phone without data writes.

## Automatic labour accumulation (2026-10-07)
- [x] Reconcile automatic labour from actual units, serialize writes per quote, remove estimate click deltas; saved/manual rate and hours overrides remain intact. Basket saves re-link existing labour transactionally before reconciling automatic rows; previews use the same projection.
- [x] In-memory add/remove/swap/two-unit/manual and PDF-rollup tests; read-only audit found zero duplicate/orphan automatic lines across two automatic-labour quotes (Q-2026-0023, Q-2026-0024); no real quote changes.
- [x] Full suite: 812/813 passed; existing unrelated Mandy map-status test still expects four choices instead of five. Automatic harness build passed. Lifecycle verification used an in-memory backend (no browser or real quote writes): labour R0 → R2,380 → R0 → R2,380 → R4,760; VAT-inclusive fixture totals R0 → R14,237 → R0 → R16,537 → R30,774.

## Labour outlines and PDF presses (2026-10-07)
- [x] Correct PDF radio to separate-click normal → selected → favourite → normal cycle; 6 targeted tests passed; guarded signed-in PDF clicks verified all three visuals, cleared basket and two intercepted favourite writes. Labour outlines unchanged.
- [x] Outline missing-labour and per-area hours rows in AreaLabourRow, LabourPanel and wizard TimeRow; generic glass styling was overriding orange. Guarded desktop/mobile estimate and Build quote checks measured 2px rgb(249, 115, 22); missing state verified with a read-response fixture.
- [x] Restore PDF single press selection and double press favourites; 14 tests passed, guarded live PDF single press changed Selected Items without a favourite write, double presses exercised intercepted favourite writes; no backend data changed.

## Shared area-name chips (2026-10-07)
- [x] Restore ordered shared chips under every creation input, preserve inline placement and repeat numbering.
- [x] 15 targeted tests passed; guarded estimate desktop/390px checks confirmed chip order, Other focus and placement above totals; all backend writes intercepted. Other builder screens covered by shared wiring/tests, not browser-verified.

## Final estimate UI fixes (2026-10-07)
- [x] Keep Create area inside the areas card after all item/service/labour rows and above totals.
- [x] Restyle Labour needed without yellow fill; verify both null-page Samsung products already render in ProductPalette (no page-number filter exists; no catalogue logic changed).
- [x] 17 targeted tests passed; signed-in read-only desktop/390px placement and both Samsung models verified; preview build OK, quote total unchanged.

## Personal favourite toggle (2026-10-07)
- [x] Confirm own-row DELETE policy; align PDF/list indicators and toggles with personal rows, optimistic updates and rollback.
- [x] Run regression checks without changing existing favourite or catalogue rows; real database mutation intentionally not exercised.

## Inline area-name controls (2026-10-07)
- [x] Check estimate, Visual PDF, Build wizard, Build Area Quote and mobile branches; move area-name/create-area controls below the last section with one instance per screen.
- [x] Verify placement and existing quote display without changing pricing or saved data (18 targeted tests passed; read-only desktop/390px checks; preview build OK).

Scope lock: equipment/materials come from the current Visual PDF book only.
`hvac_services` stays a parallel source of truth and is never filtered.

- [x] Quote picker + Items search show only non-archived products still on the current Visual PDF book (`src/lib/catalogSoT.ts`, `useQuoteBuilderProducts.ts`, `QuoteQuickEditor.tsx`).
- [x] Brand-scoped archive-on-missing in `diffImportPipeline.ts` — never archives other brands, never deletes.
- [x] Post-parse summary shows inserted / updated / archived / unchanged.
- [x] `pdf_uploads.is_active` + `brand` + `activated_at`; active vs superseded badges and an Activate action that deactivates same supplier+brand siblings and warns about open draft quotes.
- [x] `parse-price-list` documented as a non-brochure path (insert/update only).
- Region scale unchanged: `pdf_product_regions` = percent 0-100, `row_bbox` = 0-1. AR18 overlays untouched.

- [x] Hide mobile Dashboard/Live Map control bands, remove map bottom gaps, verify, and publish.

# Voice / Quote MVP (estimate page)
- [x] `src/lib/voiceQuoteKit.ts`: intent parser (copper kit w/ sizes + 10% waste + Armaflex pairing, labour, cable, chase, AC unit, client, area, confirm/cancel/undo/read-back), read-back text.
- [x] `VoiceQuoteStrip.tsx` on `/admin/estimates/:id`: mic (WavRecorder + voice-quote-parse transcribe), typed fallback, short-turn questions with ranked candidates, pending list, explicit confirm -> writes live quote via QuoteContext.
- [x] Verify kit math + build; summarize works vs stubbed.
- [ ] Voice v2 (later): cable/chase items in catalog, AC-unit → auto kit suggestion, live-mic polish.

## Visual Catalog overlay hard-lock (2026-09-10)
- [x] Controls anchored `right:10px` to PDF page box (no price_x_frac / priceColumnXFrac for placement)
- [x] Pink/magenta price frames: confirm source (baked into uploaded page images, not app-drawn) and report
- [x] Fix mobile tap selecting wrong row (hit-test in transformed overlay space)
- [x] Smaller radios on phone (visual + hit target)

## Published links, onboarding, and deposit journey (2026-09-11)
- [x] Route shared quote/customer/payment URLs through the published app origin.
- [x] Persist Welcome Tour dismissal and capped auto-show count on the user profile.
- [x] Make accepted-quote deposit invoices deterministic at 70% and preserve invoice-row handoff gating.
- [x] Add staff deposit Email, WhatsApp, and Copy link actions with honest email failures.

## 2026-09-26 batch
- [x] Critical security: expense-receipts files locked to own company (storage policies).
- [x] Live Map pin shows real deposit paid (reverted — already live, duplicate).
- [x] Search finds leads, rooms, invoices by name/address/reference (reverted — already live, duplicate).
- [x] /admin/money per-lead page, linked from Money card (By lead →), biggest balance first.
- [x] Client portal loads via token-checked get_customer_portal_data: jobs/status, invoices with paid/balance + pay link, payments.
- [x] Read-only security scan report.
- [x] Mandy mobile: one tap greets + listens (audio/mic unlocked in the tap), real-playback detection, hands-free re-listen after speechSynthesis fallback.
- [x] Mandy: speaks 12% faster (pitch kept); labour by voice pre-routed without the model, plain spoken result, honest 'I didn't change anything' guard, failed quote saves reported. Live check on Q-2026-0014 pending (quote changed since brief).
- [x] Mandy labour: rate-only edits, remove_labour (Confirm + undo), read_labour, labour rows in Mandy's context, invented labour tools mapped, remove button on the labour row. Live check on Q-2026-0014 done and reversed.

## Standard Install (open)
- [x] Live 12K/18K test + voice matrix on Q-2026-0014, restored exactly
- [x] Builder save keeps install links (remapped to new ids)
- [x] Area wizard uses the shared standard-install rule
- [ ] Admin template editor (skipped)

## Standard install follow-up (2026-09-26)
- [x] Stale build guard (index.html entry compare, banner, dock auto-reload, write refusal)
- [x] All unit-add paths on shared install rule; kits default 3 m; skips spoken
- [x] New 24K 3/8+1/2 kit, 24K template repointed, old 3/8+5/8 kit BTU cleared; kit swap UI + voice
- [ ] Live test + repair on Q-2026-0014 — blocked: quote was rewritten 14:51 UTC (Lounge/24K rows gone); needs Johan's go-ahead on current state

## Build A — in-app voice merged into Mandy (2026-09-26)
- [x] Quote mode: Grok plan (mandy-quote-plan) → shared matcher → breakdown card → addCatalogProductToQuote; turns logged in mandy_voice_logs
- [x] Matcher: x/by, spoken numbers, a couple, half, N lengths, bends → elbow
- [x] Build with voice dialog removed → opens Mandy quote mode; Quotes page Voice quote → Mandy
- [x] nl-query on Grok; nl-voice-session unlinked; WhatsApp quote bot off behind flag
- [ ] Live check signed in (Johan)

## One quote-level add bar (2026-09-28)
- [x] Replace estimate per-area add bars with one quote-level bar and requested routing.
- [x] Fix synthetic default area print label, test routing, run full tests and TypeScript check.

## Tech earnings split (2026-09-28)
- [x] Set GP tech share to 50%, add 60% labour tech share, and keep labour cost unset.
- [x] Update staff-only maths/screens and verify tests and TypeScript.

## Per-area labour (2026-09-28)
- [x] Add company labour-hours default and staff Billing field.
- [x] Add pure area labour helpers and tests.
- [x] Render/edit per-area labour, unassigned notice, and remove bottom Labour panel.
- [x] Auto-create/adjust labour for unit adds/removals/quantity changes, preserving manual and existing lines.
- [x] Block explicit area/save/send/PDF/accept actions for missing labour; keep autosave and Mandy tools non-blocking.
- [x] Add AGENTS rule; run tests and TypeScript.

## Split salesperson and technician earnings (2026-09-29)
- [x] Rename pure margin and overrun outputs for independent role earnings; remove combined total.
- [x] Show salesperson and assigned technician names with separate company shares in the staff-only Profit card.
- [x] Update Billing labels, tests, and the AGENTS earnings rule; run all tests and TypeScript.

## Full Add service picker (2026-10-07)
- [x] Show all 12 active core services in order through the shared quote-builder picker.
- [x] Keep long desktop/mobile lists scrollable and blank-description services at R0.
- [x] Verify desktop/mobile with the read-only browser guard.

## Canonical quote builder release (queued after service picker)
- [x] Match the owner-locked area-first builder flow, controls, table columns, selected basket, favourites, styling, and Add area pop-up.
- [x] Preserve existing quote loading/editing, labour reconciliation, orange labour outline, and PDF three-click cycle.
- [x] Add focused tests and verify desktop/mobile through the read-only browser guard.

## Lead assignment and routing correctness (queued last)
- [x] Send `estimated_end_time` as an ISO timestamp in `useAcceptLead`; `scheduled_for` already used the start ISO timestamp.
- [x] Source assignment choices from dispatch-active profiles in the lead's company; label/filter sales versus technician lanes correctly.
- [x] Back up and correct `auto-assign-lead` plus `broadcast_lead_to_agents` to use stored role values and lane-specific recipients; include rollback notes.
- [x] Never grant the owner's top-level account AB Refrigeration access; do not set working hours or rotate the webhook secret.
- [x] Test without modifying real leads; guarded browser checks and focused tests only.

Follow-ups only: staff working hours and webhook-secret rotation were intentionally not changed.
