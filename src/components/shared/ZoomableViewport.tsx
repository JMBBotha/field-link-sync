import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Johan 07:50: pinch-zoom on quote / PDF / document views. The app shell keeps its no-zoom viewport elsewhere
 *  (stops iOS auto-zooming into small form fields); these routes get a normal zoomable viewport. */
export const ZOOM_ROUTES = /^\/(admin\/estimates\/|quote\/|customer\/[^/]+\/invoice|admin\/invoices\/|admin\/pdf-documents)/;
const LOCKED = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
export const ZOOMABLE = "width=device-width, initial-scale=1.0, viewport-fit=cover";

export function setViewportZoomable(on: boolean) {
  const m = document.querySelector('meta[name="viewport"]');
  if (m) m.setAttribute("content", on ? ZOOMABLE : LOCKED);
}

export default function ZoomableViewport() {
  const { pathname } = useLocation();
  useEffect(() => { setViewportZoomable(ZOOM_ROUTES.test(pathname)); }, [pathname]);
  return null;
}
