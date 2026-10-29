/** UI-only grouping of bell notifications by client (Johan 29 Oct). Nothing is deleted or changed in the data. */
export interface GroupableNotification { id: string; title: string; body: string | null; created_at: string; read: boolean; metadata?: Record<string, any> | null }
export interface NotificationGroup<T> { key: string; label: string; items: T[] }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
const phoneKey = (s: string) => { const d = s.replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };

/** Client name from the body prefix, e.g. "Marina vd Merwe: follow-up call" or "Ric Meulemans · …". */
export function clientNameOf(n: GroupableNotification): string {
  const m = n.metadata || {};
  const named = m.customer_name || m.client_name || m.customerName;
  if (typeof named === "string" && named.trim()) return named.trim();
  const b = (n.body || "").split(/:| · | — | - /)[0]?.trim() || "";
  if (b && b.length <= 40 && b.split(" ").length <= 5 && /^[A-Za-z]/.test(b) && !/\d{3}/.test(b)) return b;
  return "";
}

export function clientKeyOf(n: GroupableNotification): { key: string; label: string } | null {
  const m = n.metadata || {};
  const id = m.customer_id || m.client_id;
  const name = clientNameOf(n);
  if (typeof id === "string" && id) return { key: `c:${id}`, label: name || "Client" };
  if (name) return { key: `n:${norm(name)}`, label: name };
  const ph = phoneKey(String(m.customer_phone || m.phone || ""));
  if (ph) return { key: `p:${ph}`, label: String(m.customer_phone || m.phone) };
  return null;
}

/** Keeps the incoming (newest-first) order; a group sits where its newest item would. */
export function groupNotifications<T extends GroupableNotification>(list: T[]): NotificationGroup<T>[] {
  const out: NotificationGroup<T>[] = []; const byKey = new Map<string, NotificationGroup<T>>();
  // Merge name-keyed groups into the id-keyed group of the same client name.
  const nameToId = new Map<string, string>();
  for (const n of list) { const k = clientKeyOf(n); if (k && k.key.startsWith("c:") && clientNameOf(n)) nameToId.set(`n:${norm(clientNameOf(n))}`, k.key); }
  for (const n of list) {
    const k = clientKeyOf(n);
    if (!k) { out.push({ key: `x:${n.id}`, label: "", items: [n] }); continue; }
    const key = nameToId.get(k.key) || k.key;
    let g = byKey.get(key);
    if (!g) { g = { key, label: k.label, items: [] }; byKey.set(key, g); out.push(g); }
    g.items.push(n);
  }
  return out;
}
