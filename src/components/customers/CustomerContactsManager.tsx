import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Mail, Phone, Plus, Star, Trash2, Pencil, User } from "lucide-react";

export interface ClientContact {
  id: string;
  client_id: string;
  company_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  notes: string | null;
  is_primary: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- client_contacts not yet in generated types
const client = supabase as any;

const CustomerContactsManager = ({ customerId }: { customerId: string }) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ClientContact | null>(null);
  const [open, setOpen] = useState(false);
  const key = ["client-contacts", customerId];

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: key,
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await client
        .from("client_contacts")
        .select("*")
        .eq("client_id", customerId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ClientContact[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("client_contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Contact deleted" }); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const setPrimaryMut = useMutation({
    mutationFn: async (id: string) => {
      await client.from("client_contacts").update({ is_primary: false }).eq("client_id", customerId);
      const { error } = await client.from("client_contacts").update({ is_primary: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Primary contact updated" }); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Contact people</h3>
          <p className="text-xs text-muted-foreground">Everyone you deal with at this client.</p>
        </div>
        <Button size="sm" className="gap-1" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Add contact
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : contacts.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No contact people yet.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contacts.map((c) => (
            <Card key={c.id} className="bg-card">
              <CardContent className="p-4 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-semibold text-sm truncate">{c.name}</span>
                    {c.is_primary && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                        <Star className="h-3 w-3 mr-0.5" /> Primary
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {!c.is_primary && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Set as primary" onClick={() => setPrimaryMut.mutate(c.id)}>
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => { setEditing(c); setOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete"
                      onClick={() => { if (confirm(`Delete contact "${c.name}"?`)) deleteMut.mutate(c.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {c.role && <p className="text-xs text-muted-foreground">{c.role}</p>}
                {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 text-sm hover:underline break-all"><Mail className="h-3.5 w-3.5" />{c.email}</a>}
                {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-sm hover:underline"><Phone className="h-3.5 w-3.5" />{c.phone}</a>}
                {c.notes && <p className="text-xs text-muted-foreground italic whitespace-pre-line">{c.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ContactDialog
        open={open}
        onOpenChange={setOpen}
        customerId={customerId}
        existing={editing}
        isFirst={contacts.length === 0}
        onSaved={() => qc.invalidateQueries({ queryKey: key })}
      />
    </div>
  );
};

const ContactDialog = ({
  open, onOpenChange, customerId, existing, isFirst, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string;
  existing: ClientContact | null;
  isFirst: boolean;
  onSaved: () => void;
}) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name || "");
    setEmail(existing?.email || "");
    setPhone(existing?.phone || "");
    setRole(existing?.role || "");
    setNotes(existing?.notes || "");
    setIsPrimary(existing?.is_primary ?? isFirst);
  }, [open, existing, isFirst]);

  const save = async () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (isPrimary) {
        await client.from("client_contacts").update({ is_primary: false }).eq("client_id", customerId);
      }
      const payload = {
        client_id: customerId,
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        role: role.trim() || null,
        notes: notes.trim() || null,
        is_primary: isPrimary,
      };
      const { error } = existing
        ? await client.from("client_contacts").update(payload).eq("id", existing.id)
        : await client.from("client_contacts").insert(payload);
      if (error) throw error;
      toast({ title: existing ? "Contact updated" : "Contact added" });
      onOpenChange(false);
      onSaved();
    } catch (e: unknown) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>A person you deal with at this client.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marcelle Matthews" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Role</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Accounts, Site manager" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <input id="contact_primary" type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            <Label htmlFor="contact_primary" className="text-sm cursor-pointer">Primary contact</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existing ? "Save" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CustomerContactsManager;
