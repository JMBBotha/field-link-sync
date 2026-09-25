import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useMandyRegistry } from "@/lib/mandy/registry";
import { routeReached } from "@/lib/mandy/verify";

/** Navigate, or — when the target is already the current route — force a refetch. */
export function useMandyGo() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const registry = useMandyRegistry();
  return (path: string) => {
    const here = window.location.pathname + window.location.search;
    if (routeReached(path, window.location.pathname, window.location.search) || here === path) {
      void qc.invalidateQueries();
      void registry?.get("__refresh_quote")?.({});
      return;
    }
    navigate(path);
  };
}

