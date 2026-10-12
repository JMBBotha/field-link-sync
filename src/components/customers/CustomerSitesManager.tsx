import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Building2, Loader2, Plus, Trash2, Pencil } from "lucide-react";

export interface ClientSite {
  id: string;
  client_id: string;
  company_id: string | null;
  name: string;
  address: string | null;
  notes: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- client_sites not yet in generated types
const client = supabase as any;

export type ClientType = "private" | "company" | "developer" | null;

export const sitesLabel = (t: ClientType | string | null | undefined) =>
  t === "company" ? "Offices" : t === "developer" ? "Sites" : "Addresses";

const singular = (label: string) => (label === "Addresses" ? "address" : label === "Offices" ? "office" : "site");

const CustomerSitesManager = ({ customerId, clientType }: { customerId: string; clientType?: ClientType | string | null }) => {
  const label = sitesLabel(clientType);
  const one = singular(label);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ClientSite | null>(null);
  const [open, setOpen] = useState(false);
  const key = ["client-sites", customerId];

  const { data: sites = [], isLoading } = useQuery({
    queryKey: key,
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await client
        .from("client_sites")
        .select("*")
        .eq("client_id", customerId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ClientSite[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("client_sites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Deleted" }); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{label}</h3>
          <p className="text-xs text-muted-foreground">Name and address for each one.</p>
        </div>
        <Button size="sm" className="gap-1" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Add {one}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : sites.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No {label.toLowerCase()} yet.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sites.map((s) => (
            <Card key={s.id} className="bg-card">
              <CardContent className="p-4 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-semibold text-sm truncate">{s.name}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => { setEditing(s); setOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete"
                      onClick={() => { if (confirm(`Delete "${s.name}"?`)) deleteMut.mutate(s.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm">{s.address || <span className="text-muted-foreground">No address yet</span>}</p>
                {s.notes && <p className="text-xs text-muted-foreground italic whitespace-pre-line">{s.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SiteDialog
        open={open}
        onOpenChange={setOpen}
        customerId={customerId}
        existing={editing}
        noun={one}
        onSaved={() => qc.invalidateQueries({ queryKey: key })}
      />
    </div>
  );
};

const SiteDialog = ({
  open, onOpenChange, customerId, existing, noun, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string;
  existing: ClientSite | null;
  noun: string;
  onSaved: () => void;
}) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name || "");
    setAddress(existing?.address || "");
    setNotes(existing?.notes || "");
  }, [open, existing]);

  const save = async () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        client_id: customerId,
        name: name.trim(),
        address: address.trim() || null,
        notes: notes.trim() || null,
      };
      const { error } = existing
        ? await client.from("client_sites").update(payload).eq("id", existing.id)
        : await client.from("client_sites").insert(payload);
      if (error) throw error;
      toast({ title: existing ? "Saved" : "Added" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${noun}` : `Add ${noun}`}</DialogTitle>
          <DialogDescription>Name and address.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Avec" />
          </div>
          <div>
            <Label className="text-xs">Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existing ? "Save" : `Add ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CustomerSitesManager;
