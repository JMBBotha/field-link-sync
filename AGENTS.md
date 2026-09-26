# AGENTS
- Standard-install lines link to their unit via metadata.install.unit_item_id (never parent_item_id); replace-all builder saves must remap it to the unit's new id (remapInstallUnitIds) — otherwise Mandy's install edits lose the lines.
- Stale-build detection compares the running /assets/index-*.js with a no-cache /index.html (buildInfo.checkForNewBuild) — /version.json is not reliably served by hosting.
- Piping kit sizes come only from the kit's copper component names (lib/kitSizes.ts); kit swaps reprice via kitRowFields (same maths as addKitToQuote) and keep metadata.install.
