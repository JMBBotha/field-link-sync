# Refinement Plan — Small, Shippable Steps

Goal: reduce perceived bloat without breaking the existing app. Each step is independently shippable and reversible. I'll pause after each for your OK before moving on.

## Step 1 — Sidebar IA cleanup (structure)
Reorganize the sidebar into a clean, role-aware grouping:
```
Dashboard
Leads
Customers
Jobs        → Dispatch, Schedule
Sales       → Quotes, Agreements, Invoices
Operations  → Inventory, Suppliers, Catalog, Maintenance
Reports
System      → Team, Billing, Settings, Audit, Import, Companies (admin)
```
- Collapse rarely-used items under "System"
- Enforce role visibility (Admin/Manager/Sales/Technician)
- No route deletions yet — just grouping + visibility

## Step 2 — Route audit (hide, don't delete)
- Generate a list of every route + last-used signal
- Hide anything not on the core Lead → Quote → Job → Invoice path behind a "Show advanced" toggle in System
- Keep code intact so nothing breaks; only nav entries change

## Step 3 — Dashboard density pass
- AdminHome: reduce to 4 KPI cards + 2 primary widgets (Recent Leads, Today's Jobs)
- Move secondary charts to a "More insights" collapsible
- Consistent card sizing, spacing, and typography

## Step 4 — Visual polish
- Tighten spacing scale, unify card/button radii, consistent header pattern across pages
- Standardize empty states and loading skeletons
- No structural change

## Step 5 — Mobile pass (techs)
- Verify Jobs, Schedule, Job detail are usable at 375px
- Sticky action bar on Job detail (Start / Complete / Add photo)

## Step 6 — Final sweep
- Remove any pages confirmed unused in Step 2
- Update role-based redirects & Access Denied targets

---

Suggested order: **1 → 3 → 2 → 4 → 5 → 6** (structure first, then density, then trimming).

Reply with "start step 1" (or a different starting step) and I'll ship it.