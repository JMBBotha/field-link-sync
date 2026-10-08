import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type IdentityInfo = { name: string; role: string };

const roleLabelFor = (roles: string[], dispatchRole: string | null | undefined): string => {
  if (roles.includes("admin")) return "Admin";
  if (roles.includes("field_agent")) return "Technician";
  if (roles.includes("dispatcher")) {
    return dispatchRole === "sales" || dispatchRole === "sales_engineer" ? "Sales" : "Office";
  }
  return "Office";
};

/**
 * Orange "Name · Role" pill for every layout header.
 * Uses auth.getSession() (local session, same as AuthContext) — not auth.getUser() —
 * so a flaky Auth-server round-trip cannot leave the badge blank on admin pages.
 */
const IdentityBadge = () => {
  const [info, setInfo] = useState<IdentityInfo | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadFor = async (userId: string, email: string | undefined) => {
      try {
        const [profileRes, rolesRes] = await Promise.all([
          supabase.from("profiles").select("full_name,dispatch_role").eq("id", userId).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", userId),
        ]);
        if (!mounted) return;
        const profile = (profileRes.data ?? null) as {
          full_name?: string | null;
          dispatch_role?: string | null;
        } | null;
        const roles = ((rolesRes.data ?? []) as { role: string }[]).map((r) => r.role);
        const emailPrefix = (email || "").split("@")[0];
        const rawName = (profile?.full_name || "").trim() || emailPrefix || "Me";
        setInfo({ name: rawName, role: roleLabelFor(roles, profile?.dispatch_role) });
      } catch {
        // Best-effort badge; never block the header on it.
        if (!mounted) return;
        const emailPrefix = (email || "").split("@")[0];
        if (emailPrefix) setInfo({ name: emailPrefix, role: "Office" });
      }
    };

    const applySession = (session: { user?: { id: string; email?: string | null } } | null) => {
      const user = session?.user;
      if (!user) {
        if (mounted) setInfo(null);
        return;
      }
      // Show email prefix immediately so the admin header is never empty while profiles load.
      const emailPrefix = (user.email || "").split("@")[0];
      if (emailPrefix && mounted) {
        setInfo((prev) => prev ?? { name: emailPrefix, role: "Office" });
      }
      void loadFor(user.id, user.email || undefined);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      applySession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      applySession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!info) return null;

  const firstName = info.name.split(/\s+/)[0];

  return (
    <div
      data-testid="identity-badge"
      title={`${info.name} · ${info.role}`}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-orange-500 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-white xl:pl-3 xl:pr-2"
    >
      {/* Phones/tablets: first name + role chip; desktop (≥1280): "Full Name · Role". */}
      <span className="max-w-[7rem] truncate xl:max-w-[14rem]">
        <span className="xl:hidden">{firstName}</span>
        <span className="hidden xl:inline">{info.name}</span>
      </span>
      <span className="hidden xl:inline">·</span>
      <span className="shrink-0 rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
        {info.role}
      </span>
    </div>
  );
};

export default IdentityBadge;
