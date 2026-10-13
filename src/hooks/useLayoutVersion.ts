import { useEffect, useState } from "react";

/**
 * Classic / New layout switch (Johan 13 Oct 08:18). Look only: security guards (RLS tech lead lockout,
 * RequirePlatformOwner routes) apply to both. Per-user choice in localStorage; default "new".
 * To remove later: delete this hook, src/components/classic/ and the three `isClassic` branches.
 */
export type LayoutVersion = "new" | "classic";
const KEY = "fl_layout_version";
const EVT = "fl-layout-version";

export function readLayoutVersion(): LayoutVersion {
  try { return localStorage.getItem(KEY) === "classic" ? "classic" : "new"; } catch { return "new"; }
}

export function useLayoutVersion() {
  const [version, setV] = useState<LayoutVersion>(readLayoutVersion);
  useEffect(() => {
    const f = () => setV(readLayoutVersion());
    window.addEventListener(EVT, f); window.addEventListener("storage", f);
    return () => { window.removeEventListener(EVT, f); window.removeEventListener("storage", f); };
  }, []);
  const setVersion = (v: LayoutVersion) => {
    try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
    window.dispatchEvent(new Event(EVT));
  };
  return { version, isClassic: version === "classic", setVersion, toggle: () => setVersion(version === "classic" ? "new" : "classic") };
}
