# Fix unreadable text on light/white buttons in the Quote Builder

## Problem

When opening the Quote Builder (and switching between Build / Visual PDF / Build Area Quote), some buttons render with a white or very light background while their label stays white or near-white, so the text disappears. The builder header and its toolbars still contain hardcoded `text-white` / `bg-white/10` classes that were written for the blue header bar, and those same classes get reused on light surfaces.

Verified so far: the three builder tabs themselves compute readable colours in both themes at 1280px, so the issue is in the surrounding buttons, not the tab strip. The fix is a targeted sweep rather than a single-line change.

## What will change

1. Sweep the Quote Builder surfaces for hardcoded light-on-light button styling and replace them with theme tokens:
   - `src/pages/admin/AdminQuoteBuilderPageUnified.tsx` — header back button, client chip, totals chip, search input, and the entry buttons for Visual PDF / Build Area Quote.
   - `src/components/catalog/quote-builder/ProductPalette.tsx` — "Visual" toggle and filter chips.
   - Visual PDF toolbar controls (All Suppliers, Close PDF, zoom/page controls).
   - The "Quote Builder" / "New Quote" launch buttons on the Quotes and Estimates lists.
2. Rules applied consistently:
   - Buttons on the blue header keep white text but always sit on a translucent/solid dark chip, never on a white surface.
   - Buttons on white/card surfaces use `text-foreground` (or `text-primary` for links) and `bg-card` / `bg-muted`, never `text-white`.
   - Primary/accent buttons keep their existing accent colours with `*-foreground` pairing.
3. No layout, spacing, or accent-colour changes — only foreground/background pairing.

## Verification

Screenshots of the Quote Builder in light and dark mode at both desktop (1280px) and the reported tablet width (937px), captured on each of the three builder tabs, confirming every button label is legible.
