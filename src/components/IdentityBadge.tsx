import { cn } from "@/lib/utils";
import { useSignedInIdentity } from "@/hooks/useSignedInIdentity";
import { ROLE_COLOURS, roleKindFromLabel } from "@/lib/roleColours";

/**
 * "Name · Role" pill for every layout header, coloured by role:
 * orange = Admin/Office, blue = Sales, green = Technician (see lib/roleColours).
 * Identity comes from useSignedInIdentity (auth.getSession(), not auth.getUser()),
 * so a flaky Auth-server round-trip cannot leave the badge blank on admin pages.
 */
const IdentityBadge = () => {
  const info = useSignedInIdentity();
  if (!info) return null;

  const firstName = info.name.split(/\s+/)[0];
  const kind = (!info.pending && roleKindFromLabel(info.role)) || "admin";
  const c = ROLE_COLOURS[kind];

  return (
    <div
      data-testid="identity-badge"
      data-role-kind={info.pending ? undefined : kind}
      title={`${info.name} · ${info.role}`}
      className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-2 pr-1 sm:pl-2.5 sm:pr-1.5 text-xs font-semibold text-white ring-1 ring-white/40 xl:pl-3 xl:pr-2", c.pill)}
    >
      {/* Phones/tablets: first name + role chip; desktop (≥1280): "Full Name · Role". */}
      <span className="max-w-[4.5rem] truncate sm:max-w-[7rem] xl:max-w-[14rem]">
        <span className="xl:hidden">{firstName}</span>
        <span className="hidden xl:inline">{info.name}</span>
      </span>
      <span className="hidden xl:inline">·</span>
      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none", c.chip)}>
        {info.role}
      </span>
    </div>
  );
};

export default IdentityBadge;
