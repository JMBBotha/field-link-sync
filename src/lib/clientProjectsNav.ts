import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { projectHref } from "@/lib/recordLinks";

/** A project row the client page already loaded. Scope is checked before any navigation. */
export type ClientProjectRef = { id: string; customer_id?: string | null; company_id?: string | null };

export type ClientProjectDestination =
  | { kind: "phases"; projectId: string; href: string }
  | { kind: "list" };

/**
 * Where Projects goes on a client (developer) record.
 * One project that belongs to this client and company → that project's house phases.
 * None or several → this client's own list. Never another client's project, and never the company-wide list.
 */
export function clientProjectDestination(
  customerId: string,
  projects: ClientProjectRef[],
  companyId?: string | null,
): ClientProjectDestination {
  if (!customerId) return { kind: "list" };
  const mine = projects.filter((p) => {
    if (!p.id) return false;
    if (p.customer_id && p.customer_id !== customerId) return false;
    if (companyId && p.company_id && p.company_id !== companyId) return false;
    return true;
  });
  if (mine.length !== 1) return { kind: "list" };
  return { kind: "phases", projectId: mine[0].id, href: projectHref(mine[0].id) };
}

export function revealClientProjects() {
  const el = typeof document === "undefined" ? null : document.getElementById("client-projects");
  if (!el) return;
  el.dataset.revealed = "true";
  el.scrollIntoView?.({ block: "start" });
}

type SectionActions = {
  navigate: (href: string) => void;
  setTab: (key: string) => void;
  revealList?: () => void;
};

/** "wait" = projects are still loading, so choosing one now could open the wrong development. */
export function applyClientSection(
  key: string,
  scope: { customerId: string; companyId?: string | null; projects: ClientProjectRef[] },
  actions: SectionActions,
  opts?: { projectsReady?: boolean },
): "navigated" | "list" | "tab" | "wait" {
  if (key !== "projects") {
    actions.setTab(key);
    return "tab";
  }
  if (opts?.projectsReady === false) return "wait";
  const dest = clientProjectDestination(scope.customerId, scope.projects, scope.companyId);
  if (dest.kind === "phases") {
    actions.navigate(dest.href);
    return "navigated";
  }
  actions.setTab("projects");
  actions.revealList?.();
  return "list";
}

/** Chip click for the client record. Defers while the client's own projects are still loading. */
export function useClientSectionSelect(args: {
  customerId?: string;
  companyId?: string | null;
  projects: ClientProjectRef[];
  ready: boolean;
  setTab: (key: string) => void;
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [reveal, setReveal] = useState(false);
  const { customerId, companyId, projects, ready, setTab } = args;
  const actions = { navigate, setTab, revealList: () => setReveal(true) };

  useEffect(() => {
    if (!reveal) return;
    revealClientProjects();
    // setState re-runs this effect; do not clear the retry from that cleanup or the scroll never happens.
    window.setTimeout(revealClientProjects, 50);
    setReveal(false);
  }, [reveal]);

  useEffect(() => {
    if (!pending || !ready || !customerId) return;
    setPending(false);
    applyClientSection("projects", { customerId, companyId, projects }, actions);
    // actions.navigate/setTab are stable enough for this deferred open; projects is the loaded list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, ready, customerId, companyId, projects, setTab, navigate]);

  return (key: string) => {
    if (!customerId) return;
    const result = applyClientSection(key, { customerId, companyId, projects }, actions, { projectsReady: key === "projects" ? ready : true });
    if (result === "wait") {
      setTab("projects");
      setPending(true);
    }
  };
}
