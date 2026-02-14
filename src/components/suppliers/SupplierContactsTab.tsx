import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Phone, Mail, Star } from "lucide-react";

const DEPARTMENTS = ["Sales", "Accounts", "Technical", "Dispatch", "Returns", "Management", "Other"];

interface Contact {
  id: string;
  supplier_id: string;
  contact_name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  department: string | null;
  location_branch: string | null;
  role_title: string | null;
  is_primary: boolean;
}

interface SupplierContactsTabProps {
  supplierId: string;
}

const SupplierContactsTab = ({ supplierId }: SupplierContactsTabProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    contact_name: "",
    email: "",
    phone: "",
    mobile: "",
    department: "",
    location_branch: "",
    role_title: "",
    is_primary: false,
  });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["supplier-contacts", supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_contacts") as any)
        .select("*")
        .eq("supplier_id", supplierId)
        .order("is_primary", { ascending: false })
        .order("contact_name");
      if (error) throw error;
      return data as Contact[];
    },
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ contact_name: "", email: "", phone: "", mobile: "", department: "", location_branch: "", role_title: "", is_primary: false });
    setFormOpen(true);
  };

  const openEdit = (c: Contact) => {
    setEditing(c);
    setForm({
      contact_name: c.contact_name,
      email: c.email || "",
      phone: c.phone || "",
      mobile: c.mobile || "",
      department: c.department || "",
      location_branch: c.location_branch || "",
      role_title: c.role_title || "",
      is_primary: c.is_primary,
    });
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        supplier_id: supplierId,
        contact_name: form.contact_name,
        email: form.email || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        department: form.department || null,
        location_branch: form.location_branch || null,
        role_title: form.role_title || null,
        is_primary: form.is_primary,
      };
      if (editing) {
        const { error } = await (supabase.from("supplier_contacts") as any)
          .update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("supplier_contacts") as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-contacts", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["supplier-contact-counts"] });
      toast({ title: editing ? "Contact updated" : "Contact added" });
      setFormOpen(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("supplier_contacts") as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-contacts", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["supplier-contact-counts"] });
      toast({ title: "Contact deleted" });
      setDeleteId(null);
    },
  });

  const set = (key: string, val: string | boolean) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <div className="space-y-3 mt-2">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="h-3 w-3 mr-1" /> Add Contact
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No contacts yet.</p>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <Card key={c.id} className="group">
              <CardContent className="p-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c.contact_name}</span>
                    {c.is_primary && (
                      <Badge variant="default" className="text-[10px] h-4 gap-0.5">
                        <Star className="h-2.5 w-2.5" /> Primary
                      </Badge>
                    )}
                    {c.department && <Badge variant="secondary" className="text-[10px] h-4">{c.department}</Badge>}
                    {c.location_branch && <Badge variant="outline" className="text-[10px] h-4">{c.location_branch}</Badge>}
                  </div>
                  {c.role_title && <p className="text-xs text-muted-foreground mt-0.5">{c.role_title}</p>}
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-primary">
                        <Mail className="h-3 w-3" /> {c.email}
                      </a>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-primary">
                        <Phone className="h-3 w-3" /> {c.phone}
                      </a>
                    )}
                    {c.mobile && (
                      <a href={`tel:${c.mobile}`} className="flex items-center gap-1 hover:text-primary">
                        <Phone className="h-3 w-3" /> {c.mobile}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(c)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteId(c.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Contact Name *</Label>
              <Input value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mobile</Label>
                <Input value={form.mobile} onChange={(e) => set("mobile", e.target.value)} />
              </div>
              <div>
                <Label>Role / Title</Label>
                <Input value={form.role_title} onChange={(e) => set("role_title", e.target.value)} placeholder="e.g. Sales Manager" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Department</Label>
                <Select value={form.department} onValueChange={(v) => set("department", v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Location / Branch</Label>
                <Input value={form.location_branch} onChange={(e) => set("location_branch", e.target.value)} placeholder="e.g. Cape Town" />
              </div>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
              <Label className="text-sm flex items-center gap-1"><Star className="h-3 w-3" /> Primary Contact</Label>
              <Switch checked={form.is_primary} onCheckedChange={(v) => set("is_primary", v)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => saveMutation.mutate()} disabled={!form.contact_name || saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : editing ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this contact from the supplier.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SupplierContactsTab;
