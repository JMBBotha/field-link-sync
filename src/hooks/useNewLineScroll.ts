import { useEffect, useRef, useState } from "react";

/**
 * Watches a list of line ids; when a NEW id appears (not on first render),
 * scrolls its row (data-line-id) into view and returns it briefly as `flashId`.
 */
export function useNewLineScroll(ids: string[], root?: () => ParentNode | null) {
  const seen = useRef<Set<string> | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const key = ids.join("|");

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.current!.has(id));
    ids.forEach((id) => seen.current!.add(id));
    const id = fresh[fresh.length - 1];
    if (!id) return;
    const scope: ParentNode = root?.() ?? document;
    const el = scope.querySelector(`[data-line-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    setFlashId(id);
    const t = setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return flashId;
}
