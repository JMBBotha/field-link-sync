/**
 * Role accent colours, so it's obvious who is signed in.
 * Admin (and office staff) = orange, Sales = blue, Technician = green.
 * Pill/chip shades are dark enough for white text; strip and nav shades are the brand 500/400s.
 */
export type RoleKind = "admin" | "sales" | "tech" | "office";

export type RoleColours = {
  /** IdentityBadge pill background (white text). */
  pill: string;
  /** Role chip inside the pill. */
  chip: string;
  /** Thin accent strip under each layout's top bar. */
  strip: string;
  /** Active bottom-nav item text + indicator bar (on the dark nav). */
  navText: string;
  navBar: string;
};

export const ROLE_COLOURS: Record<RoleKind, RoleColours> = {
  admin: { pill: "bg-orange-500", chip: "bg-orange-600", strip: "bg-orange-500", navText: "text-orange-400", navBar: "bg-orange-500" },
  office: { pill: "bg-orange-500", chip: "bg-orange-600", strip: "bg-orange-500", navText: "text-orange-400", navBar: "bg-orange-500" },
  sales: { pill: "bg-blue-600", chip: "bg-blue-800", strip: "bg-blue-500", navText: "text-sky-400", navBar: "bg-blue-500" },
  tech: { pill: "bg-emerald-600", chip: "bg-emerald-800", strip: "bg-emerald-500", navText: "text-emerald-400", navBar: "bg-emerald-500" },
};

/** Badge label ("Admin" | "Sales" | "Technician" | "Office") -> colour family. */
export function roleKindFromLabel(label?: string | null): RoleKind | null {
  switch (label) {
    case "Admin": return "admin";
    case "Sales": return "sales";
    case "Technician": return "tech";
    case "Office": return "office";
    default: return null;
  }
}

export function roleColours(kind: RoleKind | null | undefined): RoleColours | null {
  return kind ? ROLE_COLOURS[kind] : null;
}

/** Same precedence the IdentityBadge has always used. */
export function roleLabelFor(roles: string[], dispatchRole: string | null | undefined): string {
  if (roles.includes("admin")) return "Admin";
  if (roles.includes("field_agent")) return "Technician";
  if (roles.includes("dispatcher")) {
    return dispatchRole === "sales" || dispatchRole === "sales_engineer" ? "Sales" : "Office";
  }
  return "Office";
}
