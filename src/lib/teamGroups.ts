/** Pure grouping for the Team page tabs: Staff | Freelancers | Applications. */
export interface TeamPerson {
  id: string;
  participant_type?: string | null;
  network_status?: string | null;
  archived_at?: string | null;
}
export interface TeamAffiliation {
  id?: string;
  profile_id: string;
  status?: string | null;
  listed_as_staff?: boolean | null;
}

export const isArchived = (p: TeamPerson) => !!p.archived_at;
export const isIndependent = (p: TeamPerson) =>
  p.participant_type === "independent_sales" || p.participant_type === "independent_tech";

export const activeAffiliation = (id: string, affs: TeamAffiliation[]) =>
  affs.find((a) => a.profile_id === id && a.status === "active");

/** Freelancer = independent AND NOT (active affiliation here with listed_as_staff). */
export const isFreelancer = (p: TeamPerson, affs: TeamAffiliation[]) =>
  isIndependent(p) && !activeAffiliation(p.id, affs)?.listed_as_staff;

/** Staff tab = current team members minus archived and freelancers. */
export function staffOf<T extends TeamPerson>(members: T[], affs: TeamAffiliation[]): T[] {
  return members.filter((m) => !isArchived(m) && !isFreelancer(m, affs));
}

/** Freelancers tab = approved freelancers with an active affiliation (not listed as staff). */
export function freelancersOf<T extends TeamPerson>(people: T[], affs: TeamAffiliation[]): T[] {
  return people.filter(
    (p) => !isArchived(p) && isFreelancer(p, affs) && p.network_status === "approved" && !!activeAffiliation(p.id, affs),
  );
}

const APP_ORDER = (s?: string | null) => (s === "approved" ? 1 : s === "rejected" || s === "suspended" ? 2 : 0);

/** Applications tab = freelancers not connected here: pending, then approved, then rejected/suspended. */
export function applicationsOf<T extends TeamPerson>(people: T[], affs: TeamAffiliation[]): T[] {
  return people
    .filter((p) => !isArchived(p) && isFreelancer(p, affs) && !activeAffiliation(p.id, affs))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => APP_ORDER(a.p.network_status) - APP_ORDER(b.p.network_status) || a.i - b.i)
    .map((x) => x.p);
}

export interface DispatchRow { profile_id: string; full_name: string | null; participant_type: string | null; assignment_type: string }
/** Map dispatchable_technicians RPC rows to dialog candidates — only RPC rows, nothing else. */
export const mapDispatchCandidates = (rows: DispatchRow[] | null | undefined) =>
  (rows || []).map((r) => ({ id: r.profile_id, full_name: r.full_name, participant_type: r.participant_type, assignment_type: r.assignment_type }));
