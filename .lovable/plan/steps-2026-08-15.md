Rename the 'Ask AI' button in AdminLayout.tsx to 'Ask Mandy' to align with the voice persona, while keeping all existing functionality (icon, onClick, tooltip, styling, responsive behavior, and the voice/text mode launch logic) unchanged.

## Steps
1. In `src/components/admin/AdminLayout.tsx`, update the visible text inside the header button from `Ask AI` to `Ask Mandy`.
2. Leave the surrounding JSX, event handlers, and state unchanged.
3. Verify the build still passes after the change.
