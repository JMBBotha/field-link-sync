import { useEffect, useState } from "react";
import { Archive, Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface NoteRow { id: string; body: string; author_id: string; created_at: string; archived_at: string | null }

/** Internal client notes (author + date). Never shown to the client; archived, never deleted. */
export default function CustomerNotesPanel({ customerId, companyId }: { customerId: string; companyId: string | null }) {
  const { toast } = useToast();
  const { userId, isAdmin } = useRole();
  const { isSalesRep } = useSalesRep();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => {
    const { data, error } = await (supabase.from("customer_notes" as any) as any)
      .select("id, body, author_id, created_at, archived_at").eq("customer_id", customerId).order("created_at", { ascending: false });
    if (error) return;
    const rows = (data || []) as NoteRow[];
    setNotes(rows);
    const ids = [...new Set(rows.map((r) => r.author_id))].filter((i) => !names[i]);
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      setNames((n) => ({ ...n, ...Object.fromEntries((ps || []).map((p: any) => [p.id, p.full_name || "Team member"])) }));
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const add = async () => {
    const text = body.trim();
    if (!text || !companyId || !userId) return;
    setSaving(true);
    const { error } = await (supabase.from("customer_notes" as any) as any).insert({ customer_id: customerId, company_id: companyId, body: text, author_id: userId });
    setSaving(false);
    if (error) return toast({ title: "Could not save note", description: error.message, variant: "destructive" });
    setBody("");
    load();
  };
  const archive = async (id: string) => {
    const { error } = await (supabase as any).rpc("archive_customer_note", { p_id: id });
    if (error) return toast({ title: "Could not archive", description: error.message, variant: "destructive" });
    load();
  };

  const visible = notes.filter((n) => showArchived || !n.archived_at);
  const archivedCount = notes.filter((n) => n.archived_at).length;
  return (
    <div data-testid="customer-notes" className="space-y-3 p-3 md:p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Internal only — never shown to the client.</p>
      <div className="space-y-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an internal note…" maxLength={4000} rows={3} data-testid="note-input" />
        <Button size="sm" onClick={add} disabled={saving || !body.trim() || !companyId} data-testid="note-add">
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Add note
        </Button>
      </div>
      <ul className="space-y-2">
        {visible.map((n) => (
          <li key={n.id} data-testid="note-row" className={`rounded-md border p-2 text-sm ${n.archived_at ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap break-words">{n.body}</p>
              {!n.archived_at && (n.author_id === userId || (isAdmin && !isSalesRep)) && (
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Archive note" onClick={() => archive(n.id)}><Archive className="h-4 w-4" /></Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {names[n.author_id] || "Team member"} · {new Date(n.created_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}
              {n.archived_at ? " · archived" : ""}
            </p>
          </li>
        ))}
        {visible.length === 0 && <li className="text-sm text-muted-foreground">No notes yet.</li>}
      </ul>
      {archivedCount > 0 && (
        <Button size="sm" variant="link" className="px-0" onClick={() => setShowArchived((s) => !s)}>
          {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
        </Button>
      )}
    </div>
  );
}
