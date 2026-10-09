import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { roleColours, roleKindFromLabel, roleLabelFor, type RoleColours, type RoleKind } from "@/lib/roleColours";

export type SignedInIdentity = { name: string; role: string; /** true while only the email-prefix placeholder is known */ pending?: boolean };

// Several header pieces (badge, accent strip, bottom nav) ask at once: share one in-flight lookup per user.
const inflight = new Map<string, Promise<SignedInIdentity | null>>();

async function lookup(userId: string, email: string | undefined): Promise<SignedInIdentity | null> {
  const emailPrefix = (email || "").split("@")[0];
  try {
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("full_name,dispatch_role").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const profile = (profileRes.data ?? null) as { full_name?: string | null; dispatch_role?: string | null } | null;
    const roles = ((rolesRes.data ?? []) as { role: string }[]).map((r) => r.role);
    const rawName = (profile?.full_name || "").trim() || emailPrefix || "Me";
    return { name: rawName, role: roleLabelFor(roles, profile?.dispatch_role) };
  } catch {
    // Best-effort; never block the header on it.
    return emailPrefix ? { name: emailPrefix, role: "Office" } : null;
  }
}

function lookupShared(userId: string, email: string | undefined) {
  const key = `${userId}|${email ?? ""}`;
  let p = inflight.get(key);
  if (!p) {
    p = lookup(userId, email).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/**
 * Signed-in user's display name + role label ("Admin" | "Sales" | "Technician" | "Office").
 * Uses auth.getSession() (local session, same as AuthContext) — not auth.getUser() —
 * so a flaky Auth-server round-trip cannot leave the header blank.
 */
export function useSignedInIdentity(): SignedInIdentity | null {
  const [info, setInfo] = useState<SignedInIdentity | null>(null);

  useEffect(() => {
    let mounted = true;
    const applySession = (session: { user?: { id: string; email?: string | null } } | null) => {
      const user = session?.user;
      if (!user) {
        if (mounted) setInfo(null);
        return;
      }
      // Show email prefix immediately so the header is never empty while profiles load.
      const emailPrefix = (user.email || "").split("@")[0];
      if (emailPrefix && mounted) setInfo((prev) => prev ?? { name: emailPrefix, role: "Office", pending: true });
      void lookupShared(user.id, user.email || undefined).then((res) => {
        if (mounted && res) setInfo(res);
      });
    };
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) applySession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) applySession(session);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return info;
}

/** Colour family for the signed-in user (null until the role is known). */
export function useRoleColours(): { kind: RoleKind | null; colours: RoleColours | null } {
  const info = useSignedInIdentity();
  const kind = info?.pending ? null : roleKindFromLabel(info?.role);
  return { kind, colours: roleColours(kind) };
}
