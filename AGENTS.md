# AGENTS
- Standard-install lines link to their unit via metadata.install.unit_item_id (never parent_item_id); replace-all builder saves must remap it to the unit's new id (remapInstallUnitIds) — otherwise Mandy's install edits lose the lines.
- Stale-build detection compares the running /assets/index-*.js with a no-cache /index.html (buildInfo.checkForNewBuild) — /version.json is not reliably served by hosting.
- Piping kit sizes come only from the kit's copper component names (lib/kitSizes.ts); kit swaps reprice via kitRowFields (same maths as addKitToQuote) and keep metadata.install.
- Auto kit choice for a unit is pickKitForUnit (lib/kitSizes.ts): exact pipe_liquid+pipe_gas → brand+BTU majority → closest (with note) → BTU rule; template bundle_id is last resort. Imports never overwrite pipe fields when supplier_products.pipe_sizes_manual — brochure data beats price lists.
- Mandy quote mode: Grok (mandy-quote-plan) only returns {items:[{query,qty,length_m,area,kind}]}; every item resolves via matchCatalog and writes via writeBreakdown → addCatalogProductToQuote (spoken kit metres / install qty passed as kitLengthM / qtyByCode) — one matcher, one pricing path.
