# Mobile dashboard and Live Map cleanup

## Changes

- Hide the dashboard’s white Dashboard / Live Map / Fullscreen / New Window toolbar below `lg`, while keeping desktop controls.
- Keep the Live Map mobile header limited to the compact status-chip row; desktop retains its location, fullscreen, new-window, traffic, and search controls.
- Remove mobile bottom spacing from both `/admin` and map routes so their map areas end flush above the bottom navigation.
- Preserve the existing frosted on-map mobile controls, compact status chips, header search dialog, and desktop layouts.

## Verification

- Check Dashboard and Live Tracking at a 390×844 viewport.
- Confirm no white control strip, no grey gap, one compact chip row on Live Tracking, and maps touching the bottom tabs.
- Confirm the project builds, then publish the verified version.

## Technical details

- Scope responsive visibility to `AdminHomePage`, `AdminMapPage`, and the map-aware main container in `AdminLayout`.
- Keep bottom-navigation safe-area behavior owned by `AdminBottomNav`; do not add page-level mobile spacers on map-first screens.
