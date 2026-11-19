export const DEMO_UX_COMPANY_ID = "d390de40-0000-4000-8000-000000000001";
export const DEMO_UX_COMPANY_NAME = "Field Lynk Demo UX";
/** Suggested address. The password is never stored in the repo. Pass it to create_demo_viewer_login. */
export const DEMO_VIEWER_EMAIL_HINT = "designer@fieldlynk-demo.example";

export type DemoPreview = "admin" | "sales" | "tech";

const KEY = "fl.demo.view";
const listeners = new Set<() => void>();

export function readDemoPreview(): DemoPreview {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value === "sales" || value === "tech" || value === "admin") return value;
  } catch {
    /* private mode */
  }
  return "admin";
}

export function writeDemoPreview(value: DemoPreview) {
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    /* private mode */
  }
  listeners.forEach((listener) => listener());
}

export function subscribeDemoPreview(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A website lead must not land on the fake demo company. */
export function liveWebsiteCompanyId(id: unknown, isDemo: unknown): string | null {
  if (typeof id !== "string" || !id) return null;
  if (isDemo === true) return null;
  return id;
}
