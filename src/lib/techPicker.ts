export type TechPickerPhase = "loading" | "error" | "empty" | "ready";

/**
 * A technician menu that has not finished loading is not an empty company.
 * A missing company, or a failed read, can be retried. Only a finished read
 * with nobody left is empty.
 */
export function dispatchTechPhase(args: {
  companyId: string | null | undefined;
  companyLoading?: boolean;
  companyError?: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  count: number;
}): TechPickerPhase {
  if (args.companyLoading) return "loading";
  if (args.isFetching && args.count === 0) return "loading";
  if (args.isPending && args.count === 0) return "loading";
  if (!args.companyId || args.companyError || args.isError) return "error";
  if (args.count === 0) return "empty";
  return "ready";
}

/** Keep the last company id while a parent prop flickers off during a token refresh. */
export function heldCompanyId(current: string | null | undefined, previous: string | null): string | null {
  if (current) return current;
  return previous;
}
