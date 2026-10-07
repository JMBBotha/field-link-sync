# R6 — PDF quote builder: area-first layout and flow

## What I found (decides the approach)
- The PDF builder holds its own copy of the quote in on-screen "baskets" and saves by **replacing all lines** from that copy. The estimate page edits the saved lines directly. That's why the builder pauses saving when someone else is on the estimate page.
- The estimate editor already does most of what you've asked for:
  - area cards
  - **one** item search showing "Selected from PDF" first, then Favourites (R1), using the R2 search tags
  - specials (R4)
  - AC units automatically get their standard install and piping kit (R5 resolver)
  - per-area labour at 3.5 h per unit, or one job labour line
  - the R0 send block
- The client view and client PDF **already** fold everything into one block per area. That block shows the unit names and one area total that includes kits, materials and labour. No kit breakdown, labour hours, cost or markup are shown. Whole-job labour shows as one "Job labour" amount.

## Plan
1. **New default view, "Build quote"**, as the first tab of the PDF builder:
   - At the top: a big **Create area** button with quick chips (Bedroom, Lounge, Kitchen, Office, plus a custom name).
   - Below that: area cards (collapsible, with totals).
   - Inside each card: ONE item search drop-down (the existing estimate search).
   - The editor runs on the saved lines, like the estimate page.
2. **Saving stays safe:** while "Build quote" is open, the builder's replace-all autosave is paused. When you switch back to the older tabs, the builder reloads from the saved lines first. That means two save paths can never overwrite each other.
3. **One "Add" menu button per area:** Add area / Add item / Labour or service. The old separate buttons move under a "More" menu, so everything is still reachable. The older Area wizard and Visual PDF tabs stay as they are.
4. **Picking a unit** automatically adds its piping kit and install items, using the existing BTU, type and brand matching and the R5 resolver. They stay as separate lines you can edit or remove.
5. **Labour:** a per-quote choice between:
   - "Per unit" (preset 3.5 h × units)
   - "One total" (manual hours covering several units)
   
   Either way you can set your own hours and rate. The preset rate comes from the company's default hourly rate, which is set to R680. This uses the existing labour lines and labour mode switch, so totals work as they do today.
6. **Client view and PDF:** no change needed. Any client-facing spot I find that still shows kit or labour lines will be hidden. Contractors see everything; techs still see no money.
7. **Layout** checked at 390 px wide and on desktop, with a screenshot of each.

## Assumptions to confirm
- The R680/h preset is the **company default hourly rate**, not a fixed number in code. I'll set it if it isn't already R680.
- "Build quote" becomes the default tab. The current Area wizard tab stays under its own tab for now.

## Technical details
- Files: `AdminQuoteBuilderPageUnified.tsx` (new tab, autosave pause and reload), new `components/quoting/AreaFirstBuilder.tsx` (wraps EstimateBuilder with the Create area header and chips), `EstimateBuilder.tsx` / `EstimateDocument.tsx` (the combined Add menu and More overflow, and a labour preset/manual control using `set_quote_labour_mode`), and `QuoteBuilderLayout` left-panel defaults on phones.
- No DB schema, functions, Mandy, pricing, specials, resolver or R0 code changes.
