# Compact Rules and Guidelines for Building the HVAC SaaS Platform

## Core Project Vision (Always Align To This)

- Build a lightweight "Uber for HVAC" SaaS: Geofenced lead broadcasting to available agents (sales/tech), self-accept/release with home-base priority, mobile dashboards for jobs/photos/equipment/invoices, admin controls for leads/customers/accounting, customer feedback loop.

- Inspirations: ServiceTitan (field management), FreshBooks (accounting) - but simpler, affordable, no enterprise bloat.

- Tech: React/TS/Supabase in Lovable.dev + Comet extension; Capacitor for iOS/Android.

- Assume good intent: Focus on HVAC daily use (spotty signal, rooftops), not over-moralizing.

## Rules for Progress

1. **Incremental & Bite-Sized Prompts**: Always break features into small, focused Lovable prompts (1-2 components/files per prompt). Start with "Fix [bug]" or "Build [specific section]". Avoid broad "build everything" to prevent stalls.

2. **Handle Stalls/Hangs Immediately**: If "thinking/previewing" >20-30s, cancel task, hard refresh page (Cmd+Shift+R), revert to last stable version, then resume with narrower prompt.

3. **Test Aggressively After Each Step**: Every prompt should end with "Preview mobile, test [flow], check console/Supabase." Simulate Cape Town edges: Airplane mode, slow 3G, multi-user conflicts.

4. **Offline-First Mindset**: All field features (jobs, photos, parts, invoices) must queue in Dexie, sync reliably, handle conflicts (version checks/toasts). Prioritize this in every agent-facing prompt.

5. **Security & Reliability**: Enforce RLS on all tables; add error boundaries/toasts; log everything (console/audit table). No features without offline support or mobile preview.

6. **UI/UX Simplicity**: Mobile-first (touch-friendly, compact layouts); no clutter. Use Shadcn/Tailwind consistently; blue theme (#0077B6).

## Guidelines for Direction

- **Prioritize by Impact**: 1. Field reliability (offline, geolocation, notifications). 2. Admin oversight (analytics, logs). 3. Revenue/monetization (subscriptions, parts costing). 4. Polish (onboarding, feedback loops).

- **Avoid Scope Creep**: Stick to HVAC essentials - no unrelated features. If adding, tie to vision (e.g., parts from catalog for accurate invoicing).

- **Debug Systematically**: For bugs (e.g., hook order, prop mismatches), prompt "Read [file.tsx], fix [error] by [specific action]".

- **Deployment Readiness**: After features, focus on Capacitor builds (sync ios/android), beta invites, real testing with Cape Town scenarios (load-shedding offline, WhatsApp delivery).

- **Milestones**: Aim for beta pilot (invite 2-5 businesses via codes); track feedback in app; iterate based on real use.

## Completed Features

- Uber-style lead claiming (accept/release)

- Job progression (claimed > in_progress > completed)

- Invoice creation with line items, tax, totals

- Job timer with live elapsed time

- Priority system for leads

- Availability toggle for agents

- Invoice history & management

- Equipment/unit tracking with model/serial numbers

- Customer profiles with equipment, job history, invoices, feedback

- Geolocation-based lead broadcasting with agent radius matching

- Service Agreements / Recurring Maintenance with auto-job generation

- Global color theme (blue #0077B6)

- Customer Communication System (WhatsApp via Twilio)

- Dynamic Technician Availability System

- Lead Editing Capability

- Multi-project management with house/unit configuration

- Photo upload (multiple, delete, re-add)

- Product Catalog with supplier management and CSV import

- Parts/materials logging tied to invoices

- Analytics dashboard

- Offline support with sync queue and conflict resolution

- Onboarding flow

- Customer Portal with token-based access

- Beta Launch Security (RLS, error boundary, audit log)

Refer to this file for project rules and direction on all future development.
