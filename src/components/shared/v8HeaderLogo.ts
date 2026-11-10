/**
 * Company mark in the V8 top bar (admin, sales, and tech).
 *
 * PR #207 (0c3d1b2c) lifted this bar to full width and hid the sidebar
 * logo images inside .v8-richer-halo, but the header mark stayed
 * `lg:hidden`. Desktop then had no company logo. The mark is shown at
 * every width, object-contain, and as tall as the 4.5rem bar allows.
 */
export const V8_HEADER_ROW_CLASS = "flex h-[4.5rem] items-center gap-2 px-2 sm:px-4";

export const V8_HEADER_LOGO_CLASS =
  "h-16 w-auto max-w-[10rem] min-w-0 shrink object-contain object-left sm:max-w-[16rem] lg:max-w-[20rem] lg:shrink-0";
