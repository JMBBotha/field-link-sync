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

const IdentityBadge = () => {
  const [info, setInfo] = useState<IdentityInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!mounted || !user) return;
        const [profileRes, rolesRes] = await Promise.all([
          supabase.from("profiles").select("full_name,dispatch_role").eq("id", user.id).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", user.id),
        ]);
        if (!mounted) return;
        const profile = (profileRes.data ?? null) as {
          full_name?: string | null;
          dispatch_role?: string | null;
        } | null;
        const roles = ((rolesRes.data ?? []) as { role: string }[]).map((r) => r.role);
        const email = user.email || "";
        const rawName = (profile?.full_name || "").trim() || (email ? email.split("@")[0] : "") || "Me";
        setInfo({ name: rawName, role: roleLabelFor(roles, profile?.dispatch_role) });
      } catch {
        // Best-effort badge; never block the header on it.
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (!info) return null;

  const firstName = info.name.split(/\s+/)[0];

  return (
    <div
      data-testid="identity-badge"
      title={`${info.name} · ${info.role}`}
      className="flex min-w-0 max-w-[9rem] items-center gap-1.5 rounded-full bg-orange-500 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-white sm:max-w-[14rem] sm:pl-3 sm:pr-2"
    >
      <span className="truncate">
        <span className="sm:hidden">{firstName}</span>
        <span className="hidden sm:inline">{info.name}</span>
      </span>
      <span className="hidden sm:inline">·</span>
      <span className="shrink-0 rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
        {info.role}
      </span>
    </div>
  );
};

export default IdentityBadge;
