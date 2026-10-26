# HVAC drawings outbox (option B)

HVAC Design drops files in `/workspace/hvac-drawings-outbox/` on the box. Prototyper attaches them to the quote **only after Johan says go for that quote number**.

## Naming
- Drawing: `Q-2026-0047_G1_mechanical_RevD.pdf` (or `.png`): `Q-number_Area_label_RevX`
- Bill of quantities: `Q-2026-0047_G1_BOQ_RevD.csv` (internal only, never shown to the client)
- Area and label: letters, numbers, hyphens. No client names, addresses or phone numbers in the file name or on the drawing.

## Format
- PDF: A3 landscape, vector (not scanned), under 10 MB. PNG: at least 3000 px wide, under 10 MB.
- A new revision is a new file (RevE); untick or delete the old one on the quote.

## Commands
- `python3 outbox.py` checks names, sizes and A3 landscape; uploads nothing.
- `python3 outbox.py --approved Q-2026-0047` uploads only that quote's files. Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment (never saved). Uploaded files move to `uploaded/`.
