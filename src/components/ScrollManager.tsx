import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Route landing: the app scrolls inside <main data-scroll-root> containers, so the
 * browser never resets them. On a new page (PUSH/REPLACE of a different pathname)
 * scroll every scroll root + window to the top, or to the #hash target if present.
 * Back/forward (POP) and query-only changes (?tab=...) keep their position.
 * Landing/scroll only — no navigation behaviour changes.
 */
const ScrollManager = () => {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType === "POP") return;
    const toTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
      document.querySelectorAll<HTMLElement>("[data-scroll-root]").forEach((el) => {
        el.scrollTop = 0;
      });
    };
    if (hash) {
      let tries = 0;
      const seek = () => {
        const el = document.getElementById(decodeURIComponent(hash.slice(1)));
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        if (++tries < 20) window.setTimeout(seek, 100); else toTop();
      };
      seek();
      return;
    }
    toTop();
    // Lazy pages / page transitions mount after the first frame: re-assert once.
    const t = window.setTimeout(toTop, 120);
    return () => window.clearTimeout(t);
  }, [pathname, hash, navType]);

  return null;
};

export default ScrollManager;
