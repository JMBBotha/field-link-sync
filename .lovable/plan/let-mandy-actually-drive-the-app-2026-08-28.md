# Let Mandy actually drive the app

## The problem (confirmed in the code)

Mandy has no way to change what's on your screen. The voice tools she can call are all data tools
(`search_customers`, `get_quote`, `add_quote_item`, `create_invoice`, …) — there is no navigation or
"open this page" tool anywhere in the tool registry. Her tool webhook runs on the server and has no
channel back to the browser, so even if she wanted to open a quote she couldn't.

Because nothing stops her from *claiming* she did it, she confidently says "I've opened it" while the
page stays exactly where it was.

Today the flow is one-way: the browser pushes what you're looking at up to Mandy (page, open quote,
selected customer). We need the return path.

## What gets built

**1. A UI-action channel back to the browser**

The voice session already polls the server every couple of seconds for results and pending
confirmations. That same poll will also return queued UI actions, which the browser then performs.
No new infrastructure, and it works for both the voice panel and the text "Ask Mandy" bar.

**2. New assistant tools**

- `navigate_app` — open a named page (quotes, invoices, leads, jobs, dispatch, map, customers,
  catalog, inventory, reports, schedule, settings, dashboard).
- `open_record` — open a specific quote/estimate, invoice, customer, lead or job. Accepts a number
  ("Q-2026-0020", "INV-…") or a name, resolves it with the existing fuzzy entity resolution, and
  navigates to that record's page. If several match, she reads back the options instead of guessing.
- `go_back` / `close_panel` — small navigation helpers so "go back" works verbally.

Every one of these is company-scoped and re-checks that the record belongs to your company before
returning it, exactly like the existing tools.

**3. Honest behaviour when she can't do it**

Her instructions get a hard rule: never claim a screen changed unless the navigation tool returned
success. If the tool fails or the record isn't found, she says so. Failures are also written to the
assistant audit log, so this class of silent lie becomes visible instead of invisible.

**4. Acting on the page she just opened**

Once she can open a record, the existing write tools line up behind it: opening a quote sets it as
the live context, so "add two 12000 BTU Samsung units" then targets that quote — the path that
already works today for a quote you opened manually.

## Scope note

This first pass gives her navigation plus record-opening, and reuses the write tools that already
exist. It does not give her the ability to click arbitrary buttons or fill in arbitrary forms —
that's a much larger surface and would need per-screen wiring; worth doing later screen by screen if
you want it.

## Technical details

- Add a `voice_ui_actions` queue table (session-scoped, short-lived rows, RLS scoped to the owning
  user + company), written by `nl-voice-tool` / `assistant-tools` and drained by the existing
  `nl-voice-session` `poll` action.
- Add `navigate_app` / `open_record` / `go_back` to `supabase/functions/_shared/nlTools.ts`
  (schemas, `TOOL_KIND` as read-safe UI actions, `executeTool` branches) so voice and text share
  one implementation; register them in the transient assistant config in `nl-voice-session`.
- `open_record` resolves via `_shared/entityResolution.ts` and returns the canonical route
  (`/admin/estimates/:id`, `/admin/invoices/:id`, `/admin/customers/:id`, …).
- Client: a `useAssistantUiActions` hook mounted in the admin shell consumes the actions from the
  poll payload and calls `navigate()`; `useVoiceAssistant.ts` exposes them. Route names reuse the
  existing map in `useAssistantContextTracker.ts` so page naming stays consistent.
- Prompt update in `nl-voice-session`: navigation must go through the tool, and unconfirmed actions
  must never be reported as done.
