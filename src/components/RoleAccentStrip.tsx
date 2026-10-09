import { cn } from "@/lib/utils";
import { useRoleColours } from "@/hooks/useSignedInIdentity";

/** Thin role-coloured strip under a layout's top bar (orange admin, blue sales, green tech). */
export default function RoleAccentStrip({ className }: { className?: string }) {
  const { kind, colours } = useRoleColours();
  if (!colours) return null;
  return <div aria-hidden data-testid="role-accent-strip" data-role-kind={kind ?? undefined} className={cn("h-[3px] w-full shrink-0", colours.strip, className)} />;
}
