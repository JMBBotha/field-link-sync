/** On site. Job done stays off until the checklist, two photos and the sign-off are done. */
export function v8Checklist(kind: "install" | "service"): string[] {
  if (kind === "service") return ["Arrived", "Checked the unit", "Recorded R410 or R32"];
  return ["Arrived", "Fitted the unit", "Tested cooling"];
}

export function v8JobDoneReady(state: { checks: boolean[]; photos: number; signed: boolean }): boolean {
  return state.checks.length > 0 && state.checks.every(Boolean) && state.photos >= 2 && state.signed;
}

/** Push text is type and area only. */
export function v8TechPush(job: { type: string; area: string; clientName?: string | null }): string {
  return `${job.type} · ${job.area} · tap to view`;
}
