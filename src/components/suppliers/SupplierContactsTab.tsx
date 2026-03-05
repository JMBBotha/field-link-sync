import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Phone, Mail, Star, MapPin, MessageCircle, ExternalLink } from "lucide-react";

const DEPARTMENTS = ["Sales", "Accounts", "Technical", "Dispatch", "Returns", "Management", "Warranty", "Spares", "Other"];

interface Contact {
  id: string;
  supplier_id: string;
  contact_name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  department: string | null;
  location_branch: string | null;
  location_id: string | null;
  role_title: string | null;
  is_primary: boolean;
  whatsapp: string | null;
  direct_phone: string | null;
  extension: string | null;
}

interface Location {
  id: string;
  supplier_id: string;
  location_name: string;
  city: string | null;
  province: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  is_head_office: boolean;
  notes: string | null;
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
  const [locationFormOpen, setLocationFormOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [deleteLocationId, setDeleteLocationId] = useState<string | null>(null);

  const [form, setForm] = useState({
    contact_name: "", email: "", phone: "", mobile: "", department: "",
    location_branch: "", location_id: "", role_title: "", is_primary: false,
    whatsapp: "", direct_phone: "", extension: "",
  });

  const [locForm, setLocForm] = useState({
    location_name: "", city: "", province: "", address: "", phone: "",
    whatsapp: "", email: "", is_head_office: false, notes: "",
  });

  // Fetch locations
  const { data: locations = [] } = useQuery({
    queryKey: ["supplier-locations", supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_locations") as any)
        .select("*")
        .eq("supplier_id", supplierId)
        .order("is_head_office", { ascending: false })
        .order("location_name");
      if (error) throw error;
      return data as Location[];
    },
  });

  // Fetch contacts
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

  // Group contacts by location
  const contactsByLocation = new Map<string | null, Contact[]>();
  for (const c of contacts) {
    const key = c.location_id || null;
    if (!contactsByLocation.has(key)) contactsByLocation.set(key, []);
    contactsByLocation.get(key)!.push(c);
  }

  const openAddContact = (locationId?: string) => {
    setEditing(null);
    setForm({
      contact_name: "", email: "", phone: "", mobile: "", department: "",
      location_branch: "", location_id: locationId || "", role_title: "", is_primary: false,
      whatsapp: "", direct_phone: "", extension: "",
    });
    setFormOpen(true);
  };

  const openEditContact = (c: Contact) => {
    setEditing(c);
    setForm({
      contact_name: c.contact_name,
      email: c.email || "", phone: c.phone || "", mobile: c.mobile || "",
      department: c.department || "", location_branch: c.location_branch || "",
      location_id: c.location_id || "", role_title: c.role_title || "",
      is_primary: c.is_primary, whatsapp: c.whatsapp || "",
      direct_phone: c.direct_phone || "", extension: c.extension || "",
    });
    setFormOpen(true);
  };

  const openAddLocation = () => {
    setEditingLocation(null);
    setLocForm({ location_name: "", city: "", province: "", address: "", phone: "", whatsapp: "", email: "", is_head_office: false, notes: "" });
    setLocationFormOpen(true);
  };

  const openEditLocation = (loc: Location) => {
    setEditingLocation(loc);
    setLocForm({
      location_name: loc.location_name, city: loc.city || "", province: loc.province || "",
      address: loc.address || "", phone: loc.phone || "", whatsapp: loc.whatsapp || "",
      email: loc.email || "", is_head_office: loc.is_head_office, notes: loc.notes || "",
    });
    setLocationFormOpen(true);
  };

  const saveContactMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        supplier_id: supplierId, contact_name: form.contact_name,
        email: form.email || null, phone: form.phone || null, mobile: form.mobile || null,
        department: form.department || null, location_branch: form.location_branch || null,
        location_id: form.location_id || null, role_title: form.role_title || null,
        is_primary: form.is_primary, whatsapp: form.whatsapp || null,
        direct_phone: form.direct_phone || null, extension: form.extension || null,
      };
      if (editing) {
        const { error } = await (supabase.from("supplier_contacts") as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("supplier_contacts") as any).insert(payload);
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

  const deleteContactMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("supplier_contacts") as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-contacts", supplierId] });
      toast({ title: "Contact deleted" });
      setDeleteId(null);
    },
  });

  const saveLocationMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        supplier_id: supplierId, location_name: locForm.location_name,
        city: locForm.city || null, province: locForm.province || null,
        address: locForm.address || null, phone: locForm.phone || null,
        whatsapp: locForm.whatsapp || null, email: locForm.email || null,
        is_head_office: locForm.is_head_office, notes: locForm.notes || null,
      };
      if (editingLocation) {
        const { error } = await (supabase.from("supplier_locations") as any).update(payload).eq("id", editingLocation.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("supplier_locations") as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-locations", supplierId] });
      toast({ title: editingLocation ? "Location updated" : "Location added" });
      setLocationFormOpen(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteLocationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("supplier_locations") as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-locations", supplierId] });
      toast({ title: "Location deleted" });
      setDeleteLocationId(null);
    },
  });

  const set = (key: string, val: string | boolean) => setForm((p) => ({ ...p, [key]: val }));
  const setLoc = (key: string, val: string | boolean) => setLocForm((p) => ({ ...p, [key]: val }));

  const renderContactCard = (c: Contact) => (
    <div key={c.id} className="flex items-start justify-between gap-2 py-2 group">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{c.contact_name}</span>
          {c.is_primary && (
            <Badge variant="default" className="text-[10px] h-4 gap-0.5">
              <Star className="h-2.5 w-2.5" /> Primary
            </Badge>
          )}
          {c.department && <Badge variant="secondary" className="text-[10px] h-4">{c.department}</Badge>}
          {c.extension && <Badge variant="outline" className="text-[10px] h-4">ext. {c.extension}</Badge>}
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
          {c.direct_phone && (
            <a href={`tel:${c.direct_phone}`} className="flex items-center gap-1 hover:text-primary">
              <Phone className="h-3 w-3" /> {c.direct_phone}
            </a>
          )}
          {c.whatsapp && (
            <a
              href={`https://wa.me/${c.whatsapp.replace(/[^0-9+]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-primary"
            >
              <MessageCircle className="h-3 w-3" /> WhatsApp
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
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditContact(c)}>
          <Pencil className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteId(c.id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3 mt-2">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {locations.length} location{locations.length !== 1 ? "s" : ""} · {contacts.length} contact{contacts.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={openAddLocation}>
            <MapPin className="h-3 w-3 mr-1" /> Add Location
          </Button>
          <Button size="sm" variant="outline" onClick={() => openAddContact()}>
            <Plus className="h-3 w-3 mr-1" /> Add Contact
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-3">
          {/* Location Cards */}
          {locations.map((loc) => {
            const locContacts = contactsByLocation.get(loc.id) || [];
            return (
              <Card key={loc.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-sm">{loc.location_name}</span>
                        {loc.is_head_office && (
                          <Badge variant="default" className="text-[10px] h-4">Head Office</Badge>
                        )}
                      </div>
                      {loc.address && <p className="text-xs text-muted-foreground mt-0.5 ml-6">{loc.address}</p>}
                      <div className="flex flex-wrap gap-3 mt-1 ml-6 text-xs text-muted-foreground">
                        {loc.phone && (
                          <a href={`tel:${loc.phone}`} className="flex items-center gap-1 hover:text-primary">
                            <Phone className="h-3 w-3" /> {loc.phone}
                          </a>
                        )}
                        {loc.email && (
                          <a href={`mailto:${loc.email}`} className="flex items-center gap-1 hover:text-primary">
                            <Mail className="h-3 w-3" /> {loc.email}
                          </a>
                        )}
                        {loc.whatsapp && (
                          <a
                            href={`https://wa.me/${loc.whatsapp.replace(/[^0-9+]/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-primary"
                          >
                            <MessageCircle className="h-3 w-3" /> WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditLocation(loc)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteLocationId(loc.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {locContacts.length > 0 && (
                    <>
                      <Separator className="my-2" />
                      <p className="text-xs font-medium text-muted-foreground mb-1">Department Contacts</p>
                      <div className="divide-y divide-border">
                        {locContacts.map(renderContactCard)}
                      </div>
                    </>
                  )}

                  <Button variant="ghost" size="sm" className="text-xs mt-2 h-7" onClick={() => openAddContact(loc.id)}>
                    <Plus className="h-3 w-3 mr-1" /> Add Department Contact
                  </Button>
                </CardContent>
              </Card>
            );
          })}

          {/* Unlinked contacts (no location) */}
          {(contactsByLocation.get(null) || []).length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {locations.length > 0 ? "Contacts without location" : "All Contacts"}
                </p>
                <div className="divide-y divide-border">
                  {(contactsByLocation.get(null) || []).map(renderContactCard)}
                </div>
              </CardContent>
            </Card>
          )}

          {contacts.length === 0 && locations.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No contacts or locations yet.</p>
          )}
        </div>
      )}

      {/* Add/Edit Contact Dialog */}
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
                <Label>WhatsApp</Label>
                <Input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="+27..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Direct Phone</Label>
                <Input value={form.direct_phone} onChange={(e) => set("direct_phone", e.target.value)} />
              </div>
              <div>
                <Label>Extension</Label>
                <Input value={form.extension} onChange={(e) => set("extension", e.target.value)} placeholder="e.g. 101" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Role / Title</Label>
                <Input value={form.role_title} onChange={(e) => set("role_title", e.target.value)} placeholder="e.g. Sales Manager" />
              </div>
              <div>
                <Label>Department</Label>
                <Select value={form.department} onValueChange={(v) => set("department", v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Location</Label>
                <Select value={form.location_id} onValueChange={(v) => set("location_id", v)}>
                  <SelectTrigger><SelectValue placeholder="No location" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No location</SelectItem>
                    {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.location_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Branch (text)</Label>
                <Input value={form.location_branch} onChange={(e) => set("location_branch", e.target.value)} placeholder="e.g. Cape Town" />
              </div>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
              <Label className="text-sm flex items-center gap-1"><Star className="h-3 w-3" /> Primary Contact</Label>
              <Switch checked={form.is_primary} onCheckedChange={(v) => set("is_primary", v)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => saveContactMutation.mutate()} disabled={!form.contact_name || saveContactMutation.isPending}>
                {saveContactMutation.isPending ? "Saving..." : editing ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Location Dialog */}
      <Dialog open={locationFormOpen} onOpenChange={setLocationFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLocation ? "Edit Location" : "Add Location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Location Name *</Label>
              <Input value={locForm.location_name} onChange={(e) => setLoc("location_name", e.target.value)} placeholder="e.g. Cape Town Branch" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>City</Label>
                <Input value={locForm.city} onChange={(e) => setLoc("city", e.target.value)} />
              </div>
              <div>
                <Label>Province</Label>
                <Input value={locForm.province} onChange={(e) => setLoc("province", e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input value={locForm.address} onChange={(e) => setLoc("address", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input value={locForm.phone} onChange={(e) => setLoc("phone", e.target.value)} />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input value={locForm.whatsapp} onChange={(e) => setLoc("whatsapp", e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={locForm.email} onChange={(e) => setLoc("email", e.target.value)} />
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
              <Label className="text-sm flex items-center gap-1"><MapPin className="h-3 w-3" /> Head Office</Label>
              <Switch checked={locForm.is_head_office} onCheckedChange={(v) => setLoc("is_head_office", v)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={locForm.notes} onChange={(e) => setLoc("notes", e.target.value)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setLocationFormOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => saveLocationMutation.mutate()} disabled={!locForm.location_name || saveLocationMutation.isPending}>
                {saveLocationMutation.isPending ? "Saving..." : editingLocation ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Contact Confirmation */}
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
              onClick={() => deleteId && deleteContactMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Location Confirmation */}
      <AlertDialog open={!!deleteLocationId} onOpenChange={(o) => !o && setDeleteLocationId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete location?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the location. Contacts linked to it will be unlinked but not deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteLocationId && deleteLocationMutation.mutate(deleteLocationId)}
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
