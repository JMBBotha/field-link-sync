# Lead offer phone calls (simple Twilio keypad version) — plan, 12 Oct 2026
Approved by Johan (voice call, 12 Oct). Not Vapi. Ships SWITCHED OFF, test-allowlist only, no real calls.

## What it does
New lead (sales or service) -> Field Lynk works out who may take it using the EXISTING offer rules
(tech: `_tech_offer_fit` as used by `tech_offers`; sales: `_rep_lead_fit` as used by `rep_offerable_leads`):
role, same company only, availability/working day, 15 km nearby rule (same-day jobs or home/office base),
30-min buffer, same-client duplicate filter (`_same_client_booked`), lead still unassigned.
Only people whose contact preference is **Call** get phoned (default **App only**).
Call: "Hi <name>, new <job type> lead in <area>, <date> at <time>, about <n> hours. Press 1 to accept, 2 to pass." (TwiML Say + Gather, repeats once).
Press 1 -> `lead_call_accept` (SECURITY DEFINER, row lock): techs go through the existing `tech_accept_lead` (acting as that tech, all guards);
reps get the same checks as `rep_offerable_leads` + atomic `UPDATE ... WHERE assigned_agent_id IS NULL`. First to press 1 wins; anyone after hears "Sorry, someone already took it".
Simultaneous mode: other ringing calls are hung up with "this job has been taken"; log marks them `taken`.

## Settings (per company, table `lead_call_settings`)
enabled (master switch, default OFF) · test_only (default ON) + allowlist (Johan only) · mode single | sequential | simultaneous (default sequential) ·
max_people (5) · ring_seconds (25) · quiet hours: call only on work_days 1-5 between 08:00-17:00 SAST (configurable) · from_number (Twilio voice number, empty = no calls).
Per person: `profiles.lead_contact_pref` app | whatsapp | call (default app).

## Pieces
1. DB (docs/db-releases/2026-10-12_lead_calls*.sql, backup + rollback): settings table, attempts log `lead_call_attempts` (every attempt + outcome, Twilio SID, digits, dry_run), profile column,
   `lead_call_candidates(lead)`, `lead_call_accept(attempt)`, trigger on new lead -> pg_net to edge fn (no-op unless enabled), token in `app_webhook_config.lead_call_token`.
2. Edge function `lead-offer-call` (verify_jwt=false; token auth for start; Twilio signature check for webhooks): start / twiml / gather / status; dry-run path logs who WOULD be called without dialling.
3. UI: later (contact preference picker on My profile, admin settings card). Until then settings are set by SQL by me.
4. WhatsApp mode: uses existing WhatsApp notification once the live sender exists (logged as `whatsapp_pending` for now).

## Safety
Master switch OFF, test_only ON, allowlist = Johan, no from_number -> zero real calls possible. No number bought.

## Cost
Twilio SA mobile ~R4-7/min (calls < 1 min) + voice number ~USD 1-6/mo (SA local numbers need regulatory bundle). Deploy: 1 Lovable credit (new function).

## Johan must do
1. Get a voice-capable Twilio number (SA number needs address + ID bundle) or verify his own mobile as caller ID for testing.
2. Confirm his test mobile number on his profile.
3. Say "switch on test" -> I set from_number, enabled=true (test_only stays on), do one test call to him; then "switch on for everyone".

## Added (Johan, 13:20): admin always sees every lead + call status
- Calls never change lead visibility: nothing in this feature filters, hides, archives or reassigns a lead except a real accept (which the admin already sees as Accepted).
- Admin lead cards show a call-status chip from `lead_call_status_summary(lead_ids)` (admin/ops of that company only):
  "Calling Thabo…", "2 passed", "No answer (3)", "Accepted by Thabo at 13:42", "Not phoned – outside call hours", "Test run (no call)".
- Chip refreshes on the existing leads query poll; lives in the admin/dispatch lead card only.

---
# PROPOSALS (not built yet)

## A) New-leads count button colour (reuse existing lead ageing)
Already exists: `lead_sla_settings` table + Settings card `LeadSlaSettingsCard` (enabled, contact minutes = 5, work days, open 08:00, close 17:00, amber cut-off 15:00),
`src/lib/leadClock.ts` (per-lead tone green/yellow/orange/red/amber, quote/visit due same day by close), `useLeadSla`, `AttentionStrip`, `first_contact_at`/`contact_attempts` on leads.
Proposal: the New-leads count button takes the WORST tone of its leads using the same `leadClock`:
- green = every lead has a follow-up (first_contact_at or any trail event below);
- amber = any lead with no follow-up after `contactMinutes` (5, adjustable);
- red = any lead with no follow-up after 30 min (new setting `red_minutes`, default 30) OR no quote/visit by the same-day close.
Work-hours clock (out of hours doesn't count). Effort ~0.5 day, frontend + 1 column. Credits 0 (GitHub + SQL).

## B) Per-lead activity trail (automatic)
Reuse, don't duplicate: `communication_log`, `notification_logs`/`notification_queue` (WhatsApp/SMS), `email_events` (Resend), `status_change_log` + `audit_log` (lead/quote/appointment changes),
`job_activity_log`, `lead_routing_log` (offers/dispatch), `payment_events`, new `lead_call_attempts`.
Proposal: one read-only DB view/RPC `lead_activity(lead_id)` that UNIONs those sources into (at, kind, label, who) – no new write path except:
- Twilio WhatsApp status callback -> update queued/sent/delivered/read on the existing notification row (small edge fn change);
- Resend webhook -> `email_events` delivered/opened (check webhook is registered once the domain is verified);
- "Add note" on the card -> communication_log.
Shown as a collapsible timeline on the admin lead card beside the call-status chip; any staff-made contact event counts as follow-up for A).
Effort ~1.5-2 days. Credits: 0 for SQL + UI; ~1-2 Lovable credits if the WhatsApp webhook / Resend webhook edge functions need redeploying (0 with a Supabase deploy token).

## C) PROPOSAL: LEAD vs GENERAL classification (Johan 13:23)
- Lead = needs a visit (sales quote/site visit, or tech install/service/repair call-out). General = info questions, invoice/statement requests, admin updates, reschedules of an existing booking (those update the booking).
- Only leads feed the New-leads button (colour A, timeline B, phone-out calls). General items -> bell notifications (`notifications`).
- Sources (reuse what exists): web/booking forms by form type (`_shared/websiteIntake.ts`, `receive-website-lead`); Mandy (`receive-vapi-lead` / `_shared/leadIntake.ts`) gets a required `intent` = visit_request | general from her existing summary;
  WhatsApp/email via `_shared/inboundIntent.ts` keywords + AI intent with confidence (`leads.confidence` exists); low confidence -> bell as "possible lead", one tap Promote.
- Same-client duplicate check (`_same_client_booked`, `lead_duplicate_flags`) runs first, so a reschedule from a known client updates the booking instead of creating a lead.
- Admin reclassify either way in one tap, logged to the timeline (B). Phone-out calls only for leads (already true: calls start from the `leads` table only).
- Effort ~1.5-2 days. Credits: 0 for SQL/UI; ~2-3 Lovable credits to redeploy intake edge functions (receive-vapi-lead, twilio-whatsapp-webhook, ingest-lead), or 0 with a Supabase deploy token. Mandy's Vapi tool schema change is a config update (no credits).

## D) Work type routing TECH vs SALES (Johan 13:23)
- Reuses the existing field `leads.primary_intent` (enum sales | service). NULL = **unsure**. Today: 3 service, 7 sales, 24 unsure.
- Rule: accepted quote or existing unit with a problem -> TECH (service); no quote yet / new install enquiry / pricing -> SALES.
- Visibility already follows it: `tech_offers` = service leads to techs, `rep_offerable_leads` = sales leads to reps, admin sees all.
- **BUILT now:** unsure leads are never phoned (`lead_call_candidates` returns nobody; log says "work type unsure – admin to pick").
- **Proposed (needs Johan's OK because it changes what techs see):** `tech_offers` currently treats unsure as service (techs see the 24 unsure leads). Proposal: unsure -> admin only until picked.
- Proposed: classifier sets primary_intent from form dropdown / Mandy `work_type` + reason / AI + keywords + client record lookup (open accepted quote or job -> tech); confidence below threshold -> leave NULL.
  One-tap admin "Tech | Sales" toggle on the lead card, logged in `status_change_log`. Effort ~1 day; credits same as C (shared intake redeploys).

## E) PROPOSAL: escalation ladder (timers per company, working hours only; out-of-hours clocks start at 08:00)
| Level | When (no accept yet) | Action |
|---|---|---|
| 0 | 0 min | Offer + calls to matched staff (built: lead-offer-call) |
| 1 | 5 min | Re-offer to the next ring: widen to 30 km, then all staff of that work type; New-leads button amber |
| 2 | 15 min | Office/dispatcher: bell + WhatsApp; lead pinned to top of admin dashboard with "Unclaimed" banner |
| 3 | 30 min (red) or no quote by 16:00 same day | Phone/WhatsApp the owner (Johan) with the lead summary: press 1 = take it, 2 = send to everyone again |
- Any accept or real follow-up (trail B) stops it. Every step logged in the timeline. Only the lead's own company staff/owner (company isolation as in `lead_call_candidates`).
- Build: `lead_escalation_settings` (minutes per level, 30 km widen, 16:00 cut-off) + `escalation_level`/`escalated_at` on leads, a pg_cron job every minute calling `lead_escalate_tick()` (SQL decides level) -> pg_net to lead-offer-call `action=escalate` (reuses the same calling + keypad code; owner call adds "2 = re-offer to all").
  `_staff_slot_fit` needs a radius parameter for the 30 km ring (today fixed 15 km).
- Effort ~1.5-2 days. Credits: ~1 (redeploy lead-offer-call) or 0 with a deploy token. Depends on A/B for "follow-up" and on a voice number for calls.

## Total proposals effort: A 0.5 d, B 1.5-2 d, C 1.5-2 d, D 1 d, E 1.5-2 d ≈ 6-7.5 days; credits ≈ 4-6 if done via Lovable redeploys (0 with a Supabase deploy token).
