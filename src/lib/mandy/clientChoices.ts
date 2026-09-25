import type { MandyResult } from "@/lib/mandy/actions";

export interface ClientHit { id: string; name: string }

export const ADD_NEW_CLIENT_CHOICE = { label: "Add new client", action: "add_new_client", args: {} as Record<string, unknown> };

/**
 * find_client result: ALWAYS visible chips (one per match + "Add new client"),
 * and on a single exact match also opens that client. Never bare "Found …".
 */
export function buildFindClientResult(
  query: string,
  hits: ClientHit[],
  exactSingle: boolean,
): MandyResult & { openClientId?: string } {
  const chips = [
    ...hits.map((c) => ({ label: c.name, action: "open_client", args: { client_id: c.id, name: c.name } })),
    ADD_NEW_CLIENT_CHOICE,
  ];
  if (!hits.length) {
    return { ok: true, message: `No client matching “${query}”. The user can tap Add new client.`, choices: chips };
  }
  if (hits.length === 1 && exactSingle) {
    const c = hits[0];
    return { ok: true, message: `Opened ${c.name}.`, data: { client_id: c.id, name: c.name }, choices: chips, openClientId: c.id };
  }
  return { ok: true, message: `${hits.length} clients match “${query}”. Waiting for the user to tap one.`, choices: chips };
}
