import type { Json } from "@/integrations/supabase/types";

/** A JSON object. Arrays and scalars are not records. */
export function jsonObject(value: Json | null | undefined): { [key: string]: Json | undefined } | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}

export function jsonString(value: Json | undefined | null): string | null {
  return typeof value === "string" ? value : null;
}

export function jsonNumber(value: Json | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function jsonBoolean(value: Json | undefined | null): boolean {
  return value === true;
}

export function stringRecord(value: Json | undefined | null): Record<string, string> {
  const row = jsonObject(value);
  const out: Record<string, string> = {};
  if (!row) return out;
  for (const [key, item] of Object.entries(row)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

/** Plain data that can be stored in a jsonb column. Drops `undefined` fields, same as JSON.stringify. */
export function toJson(value: unknown): Json {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A number in this value is not finite");
    return value;
  }
  if (Array.isArray(value)) return value.map((item): Json => toJson(item));
  if (value && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      out[key] = toJson(item);
    }
    return out;
  }
  throw new Error("This value cannot be stored as JSON");
}

/** `{ ok, message }` jsonb results from the lead-assignment RPCs. */
export function rpcOk(value: Json | null): { ok: boolean; message: string } {
  const row = jsonObject(value);
  return {
    ok: row?.ok === true,
    message: typeof row?.message === "string" ? row.message : "",
  };
}
