
# Fix Photo Gallery Scrolling

## Problem
The ScrollArea component is applied but scrolling isn't working properly because the height constraint needs to be set correctly for the Radix ScrollArea to enable scrolling.

## Solution
Change `max-h-48` to a fixed `h-48` with `overflow-hidden` on the ScrollArea, ensuring the container has a definite height that allows the ScrollArea to calculate when scrolling is needed.

## Technical Changes

### File: `src/components/PhotoGallery.tsx`

**Line 205** - Update the ScrollArea className:
- Change from: `className="max-h-48"`
- Change to: `className="h-48"` 

This ensures the ScrollArea has a fixed height constraint that triggers scrolling when content exceeds 192px (12rem).

## Why This Works
- Radix ScrollArea requires a defined height on the container to know when to show scrollbars
- `max-h-48` only limits maximum height but doesn't define a fixed viewport
- `h-48` sets a fixed height, allowing the ScrollArea viewport to properly calculate overflow and enable vertical scrolling

## Alternative Consideration
If you want the gallery to be smaller when there are few photos but scroll when there are many, we can use `max-h-48` combined with making the inner content `min-h-0` - but a fixed height is simpler and works reliably.
