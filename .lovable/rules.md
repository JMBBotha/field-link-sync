# field-link-sync Project Rules

These rules are automatically included in every Lovable AI prompt. Follow them strictly.

## 1. PROJECT OVERVIEW

HVAC field service platform (0800-BE-COOL / AC Super Service) built with React + Supabase.
- Admin dashboard: leads, customers, dispatch, scheduling, map
- Quote Builder: visual PDF catalog overlay with area-based quoting, drag-and-drop, bundles, zones, markup
- PDF Import Pipeline: upload supplier PDFs -> AI extraction -> match to supplier_products DB -> visual overlay -> add to quote
- Documents: quotes, proposals, invoices, agreements with shared branded header
- Field Agent View: mobile-friendly technician interface
- Integrations: FreshBooks, Mapbox, Twilio/WhatsApp, Supabase

## 2. PRICING RULES (NEVER VIOLATE)

- ALL pricing math MUST use `@/utils/pricing.ts` (`calculatePricing`, `exclVatFromIncl`, `inclVatFromExcl`)
- NEVER inline price calculations anywhere else
- VAT is 15% (South Africa)
- Pricing chain: cost_excl_vat -> apply supplier_discount_% -> apply default_markup_% -> selling_price
- NEVER double-discount (apply discount only once)
- Markup % must be CALCULATED as ((sellingPrice / costPrice) - 1) * 100, not read from stored field
- Supplier PDF prices are INCL VAT - always use rightmost R-prefixed price column

## 3. PDF VISUAL CATALOG OVERLAY - CRITICAL RULES

This is the most bug-prone area. These rules exist because 40+ commits were spent fixing overlay bugs.

### Icon Rules (NO EXCEPTIONS)
- Every priced data row gets exactly ONE icon pair (checkbox + cart)
- Icons MUST be vertically centered on each row (flexbox: align-items:center, justify-content:center, height:100%)
- Row numbers (1, 2, 3...) MUST appear next to each icon per page
- NO icons on title/header rows - only rows with BOTH an R-prefixed price AND a product code matching /[A-Z]{2}\d/
- NO ghost icons in empty space below tables
- First data row on every page MUST always get an icon - dedup must NEVER remove it
- Icon horizontal position: use computeIconLeftPct() clamped 85-96% of page width

### Extractor Rules (pdfTextExtractor.ts)
- Group text items into rows by y-position (avgHeight * 1.2 tolerance)
- Take RIGHTMOST R-prefixed price per row (= INCL VAT column)
- Match to DB products case-insensitively
- Dedup uses dedupKey (product_code|label|price) within-page only
- NEVER use aggressive y_pct rounding that collides adjacent rows
- NEVER remove dedup entirely (causes duplicates)

### Key Files (HIGH RISK - touch with extreme care)
- `pdfTextExtractor.ts` - rewritten 4+ times, extraction algorithm
- `PdfPageOverlay.tsx` - icon rendering, 20+ edits historically
- `VisualCatalogPanel.tsx` - orchestrates PDF viewer + overlay + selection
- `ProductInfoDialog.tsx` - product detail popup
- `pricing.ts` - STABLE, central pricing utils, do NOT duplicate

## 4. CODE CHANGE RULES

- When editing a file, do NOT rename existing props/functions unless explicitly asked
- When adding a prop to a component, ALWAYS add it to BOTH the type definition AND the destructured props
- After editing any component, verify all files that import it still pass the correct props
- NEVER add module-level mutable state (Sets, Maps) in React components
- When fixing one bug, do NOT modify unrelated code
- If a file has a LOCKED comment, check with the user before modifying

## 5. TESTING REQUIREMENTS

After ANY PDF overlay change, verify these pages:
- Page 2: No icon on title row, all data rows have icons
- Page 3: First item (AR80F12CADW/FA) has icon #1
- Page 5: All 23 items have centered icons with numbers
- Page 7: Controllers page has icons (even if 0 matched)
- Page 10: No ghost icons in empty space
- Page 17: Correct count, no duplicates
- ALL pages: icons vertically centered, row numbers sequential

## 6. COMMON BUG PATTERNS TO AVOID

- "X is not defined" -> prop added to type but not destructured
- Double/duplicate icons -> dedup too loose or removed
- Missing first row -> dedup colliding header with first data row
- Wrong prices -> taking wrong R-value from multi-price rows
- 0% markup display -> using stored field instead of calculating
- Cascade delete failures -> missing FK CASCADE on supplier tables

## 7. ARCHITECTURE CONSTRAINTS

- Supabase is the database (79 tables)
- Key tables: supplier_products (435 rows), quotes (156), audit_log, dismissed_pdf_regions, supplier_pdf_pages
- Shared components: DocumentHeader for all doc types, ProductPalette for product selection
- React + TypeScript + Tailwind CSS + shadcn/ui
- DnD Kit for drag-and-drop
- pdf.js for PDF rendering

## 8. WORKFLOW

1. Identify bug with specific page/screenshot evidence
2. Read the exact file/function before changing anything
3. Make minimal, targeted changes to fix ONLY the reported issue
4. Verify ALL affected pages after change, not just the reported one
5. If a change introduces new bugs, REVERT immediately - do not stack patches
