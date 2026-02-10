
# Add "Create Service Agreement" Access from Maintenance Scheduler

## Problem
The Maintenance Scheduler page (`/admin/maintenance`) has no way to create a new Service Agreement directly. Users must navigate separately to `/admin/agreements` to set one up before maintenance schedules can be generated.

## Solution
Add a prominent "New Agreement" button to the Maintenance page header that either:
- Links directly to the Agreements page, OR
- Opens an inline dialog to create an agreement right from the Maintenance page

I recommend the simpler approach: add a **"New Agreement" button** in the header that navigates to `/admin/agreements`, plus a **quick-action link** in the empty state when no schedules exist. This keeps the existing full-featured agreement form reusable without duplicating it.

## Changes

### 1. `src/pages/admin/AdminMaintenancePage.tsx`
- Add a **"+ New Agreement"** button next to the existing "Generate Schedules" button in the header area
- The button will use `react-router-dom`'s `useNavigate` to go to `/admin/agreements`
- Update the **empty state** card (when no schedules exist) to include a "Create Agreement" link alongside the existing "Generate from Agreements" button
- Add a small info note below the header: "Maintenance schedules are auto-generated from Service Agreements"

### Technical Details

**Header buttons (new button added):**
```text
[+ New Agreement]  [Generate Schedules]
```

**Empty state update:**
```text
No maintenance schedules found.
Create a Service Agreement first, then generate schedules.
[Create Agreement]  [Generate from Agreements]
```

**Imports to add:**
- `useNavigate` from `react-router-dom`
- `Plus` icon from `lucide-react`
