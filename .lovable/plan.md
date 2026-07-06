## Goal
When a lead/job is accepted, don't just flip a status — immediately open a "Schedule & Assign" dialog that captures the essentials, then create/update the linked Job in one shot.

## New shared component

`src/components/leads/AcceptLeadDialog.tsx`

Opens when the user clicks Accept. Reuses the existing `AppointmentPicker` (already wraps date/time + technician suggestions) and `LocationSelector`. Fields:

- **Scheduled date & time** — required. Prefilled to "today + 1h".
- **Assigned technician** — dropdown of company members with role `field_agent` / `technician`. AppointmentPicker already returns `agent_id`.
- **Job type / title** — prefilled from lead `service_type`.
- **Description / notes** — prefilled from lead `notes`.
- **Location** — only shown when the customer has >1 saved location; defaults to the lead's address. Uses existing `LocationSelector`.
- **Priority** — inherits from lead, editable.

On submit:
1. `UPDATE leads SET status='accepted', assigned_agent_id=…, started_at=now()` (only on first accept).
2. If the lead already has a linked job → `UPDATE jobs` with scheduled_for / assignee / address / notes / status='scheduled'.
   Otherwise → `INSERT jobs` linked via `lead_id` + `customer_id`, then `INSERT assignments` for the technician with status='accepted'.
3. Write to `job_activity_log` ("Lead accepted and scheduled").
4. Toast + invalidate `["leads"]`, `["jobs*"]`, `["my-jobs"]`, `["dispatch"]`.
5. Optionally navigate to `/admin/jobs/:id` on desktop (skip on field-agent mobile).

Cancel closes the dialog and leaves the lead in its previous status — no partial writes.

## Wire the dialog into every accept surface

Same component, same handler everywhere:

| Surface | File | Change |
|---|---|---|
| Lead detail sheet (admin map + leads list) | `src/components/LeadDetailSheet.tsx` | Replace direct `onAccept(lead.id)` calls (lines 744, 930) with opening `AcceptLeadDialog`. |
| Admin map page | `src/pages/admin/AdminMapPage.tsx` | Replace the current `infoAction` stub passed as `onAccept` with the real handler that opens the dialog. |
| Field agent card / list | `src/components/FieldAgentLeadCard.tsx` + `src/pages/FieldAgent.tsx` (`handleAcceptLead`, line 398) | Route the button through the dialog before calling `offlineLeads.acceptLead`. Mobile-friendly: dialog uses `Sheet` on `useIsMobile()`.  |
| Dispatch board | `src/pages/admin/AdminDispatchPage.tsx` (+ `AdminJobsDispatchPage.tsx`) | When a card is dragged/clicked to "Accepted" lane, open the dialog. |
| Job detail (mobile) | `src/pages/admin/AdminJobDetailPage.tsx` | Change status → "Accepted/Scheduled" opens the same dialog, prefilled from the existing job. |

## Data / backend

No schema change needed — `jobs`, `assignments`, `job_activity_log`, `customer_locations` already have everything. RLS on `jobs`/`assignments` already scoped by `company_id`.

Offline path: `useOfflineLeads.acceptLead` stays; the dialog just calls it with the extra fields, and the sync queue already replays writes.

## Tech details

- Zod schema validates required scheduled_for + agent_id.
- One `useAcceptLead` hook centralises the mutation so every surface stays consistent.
- Skeleton diff: ~1 new component (~250 LoC), ~1 new hook (~120 LoC), 6 small call-site edits.

## Verification

Manual: accept the "Jules Harding" lead from (a) admin map lead sheet, (b) leads list, (c) dispatch board, (d) field agent mobile card, (e) job detail page — each opens the dialog, submits, and shows the resulting scheduled job on `/admin/jobs` and on the schedule calendar.
