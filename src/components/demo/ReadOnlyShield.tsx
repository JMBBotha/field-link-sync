import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useRole } from "@/hooks/useRole";
import { readDemoPreview, subscribeDemoPreview, writeDemoPreview, type DemoPreview } from "@/lib/demoViewer";

const WRITE_CONTROL = /\b(send|save|book|archive|delete|email|pay|assign|create|add|edit|update|confirm|invite|approve|reject|upload|record|mark|complete|start|log|remove|accept|decline|dispatch|issue|invite)\b/i;

function useDemoPreview(): DemoPreview {
  return useSyncExternalStore(subscribeDemoPreview, readDemoPreview, () => "admin");
}

/** Second layer only. Postgres rejects the write even if this is bypassed. */
function blockWrite(event: Event) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest) return;
  if (target.closest("[data-demo-allow]")) return;
  if (event.type === "submit") {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const control = target.closest("button, input, textarea, select, [contenteditable='true']");
  if (!control || control.closest("[data-demo-allow]")) return;
  const tag = control.tagName;
  if (tag === "INPUT") {
    const type = ((control as HTMLInputElement).type || "").toLowerCase();
    if (type === "search" || type === "checkbox" || type === "radio") return;
  }
  const label = `${control.getAttribute("aria-label") || ""} ${control.textContent || ""}`;
  const writing = tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !["search", "checkbox", "radio"].includes(((control as HTMLInputElement).type || "").toLowerCase())) || WRITE_CONTROL.test(label);
  if (!writing) return;
  event.preventDefault();
  event.stopPropagation();
}

export function DemoViewBanner() {
  const preview = useDemoPreview();
  const navigate = useNavigate();
  const choose = (next: DemoPreview, path: string) => {
    writeDemoPreview(next);
    navigate(path);
  };
  return (
    <div data-testid="demo-readonly-banner" data-demo-allow="true" className="flex flex-wrap items-center gap-2 border-b border-[#C2410C]/30 bg-[#fff7ed] px-3 py-2 text-sm text-[#7c2d12] dark:border-white/15 dark:bg-[#1a120c] dark:text-[#fed7aa]">
      <strong>View only.</strong>
      <span>Field Lynk Demo UX uses fake clients. This login cannot change or send anything.</span>
      {(["admin", "sales", "tech"] as const).map((role) => (
        <button
          key={role}
          type="button"
          data-demo-allow="true"
          data-testid={`demo-view-${role}`}
          aria-pressed={preview === role}
          className="rounded-full border border-current px-2 py-0.5 text-xs font-semibold"
          onClick={() => choose(role, role === "tech" ? "/field" : "/admin")}
        >
          {role === "admin" ? "Admin" : role === "sales" ? "Sales" : "Tech"}
        </button>
      ))}
    </div>
  );
}

export default function ReadOnlyShield({ children }: { children: ReactNode }) {
  const { isReadOnly } = useRole();
  useEffect(() => {
    if (!isReadOnly) return;
    document.addEventListener("click", blockWrite, true);
    document.addEventListener("submit", blockWrite, true);
    return () => {
      document.removeEventListener("click", blockWrite, true);
      document.removeEventListener("submit", blockWrite, true);
    };
  }, [isReadOnly]);
  if (!isReadOnly) return <>{children}</>;
  return (
    <>
      <DemoViewBanner />
      {children}
    </>
  );
}
