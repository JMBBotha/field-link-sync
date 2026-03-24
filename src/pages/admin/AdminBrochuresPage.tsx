import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Upload, Trash2, Edit2, Eye, Check, X, GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Brochure {
  id: string;
  name: string;
  brand: string;
  file_url: string;
  file_name: string;
  model_match_prefixes: string[];
  linked_product_ids: string[];
  is_active: boolean;
  sort_order: number;
  page_count: number | null;
  created_at: string;
}

interface BrochureForm {
  name: string;
  brand: string;
  model_match_prefixes_text: string;
  sort_order: number;
  is_active: boolean;
}

const emptyForm: BrochureForm = {
  name: "",
  brand: "",
  model_match_prefixes_text: "",
  sort_order: 0,
  is_active: true,
};

const AdminBrochuresPage = () => {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BrochureForm>(emptyForm);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: brochures = [], isLoading } = useQuery({
    queryKey: ["product-brochures"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_brochures")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as Brochure[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const brochure = brochures.find((b) => b.id === id);
      if (brochure?.file_name) {
        await supabase.storage.from("product-brochures").remove([brochure.file_name]);
      }
      const { error } = await supabase.from("product_brochures").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-brochures"] });
      toast.success("Brochure deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("product_brochures").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-brochures"] }),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setUploadFile(null);
    setDialogOpen(true);
  };

  const openEdit = (b: Brochure) => {
    setEditingId(b.id);
    setForm({
      name: b.name,
      brand: b.brand,
      model_match_prefixes_text: b.model_match_prefixes.join(", "),
      sort_order: b.sort_order,
      is_active: b.is_active,
    });
    setUploadFile(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setUploading(true);
    try {
      let file_url = "";
      let file_name = "";

      if (uploadFile) {
        const ext = uploadFile.name.split(".").pop() || "pdf";
        file_name = `${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("product-brochures")
          .upload(file_name, uploadFile, { contentType: uploadFile.type });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("product-brochures").getPublicUrl(file_name);
        file_url = urlData.publicUrl;
      }

      const prefixes = form.model_match_prefixes_text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (editingId) {
        const updatePayload: any = {
          name: form.name.trim(),
          brand: form.brand.trim(),
          model_match_prefixes: prefixes,
          sort_order: form.sort_order,
          is_active: form.is_active,
        };
        if (file_url) {
          updatePayload.file_url = file_url;
          updatePayload.file_name = file_name;
        }
        const { error } = await supabase.from("product_brochures").update(updatePayload).eq("id", editingId);
        if (error) throw error;
        toast.success("Brochure updated");
      } else {
        if (!file_url) {
          toast.error("Please upload a PDF file");
          setUploading(false);
          return;
        }
        const { error } = await supabase.from("product_brochures").insert({
          name: form.name.trim(),
          brand: form.brand.trim(),
          file_url,
          file_name,
          model_match_prefixes: prefixes,
          sort_order: form.sort_order,
          is_active: form.is_active,
        });
        if (error) throw error;
        toast.success("Brochure created");
      }

      queryClient.invalidateQueries({ queryKey: ["product-brochures"] });
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Brochure Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage product brochures that auto-attach to quote PDFs based on model prefix matching
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Brochure
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Order</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Match Prefixes</TableHead>
                <TableHead className="w-20">Active</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : brochures.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No brochures uploaded yet. Click "Add Brochure" to get started.
                  </TableCell>
                </TableRow>
              ) : (
                brochures.map((b) => (
                  <TableRow key={b.id} className={!b.is_active ? "opacity-50" : ""}>
                    <TableCell className="font-mono text-xs">{b.sort_order}</TableCell>
                    <TableCell>
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground">{b.file_name}</div>
                    </TableCell>
                    <TableCell>{b.brand}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {b.model_match_prefixes.length > 0 ? (
                          b.model_match_prefixes.map((p, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {p}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={b.is_active}
                        onCheckedChange={(checked) =>
                          toggleActiveMutation.mutate({ id: b.id, is_active: checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {b.file_url && !b.file_url.includes("placeholder") && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setPreviewUrl(b.file_url)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => openEdit(b)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm("Delete this brochure?")) deleteMutation.mutate(b.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Brochure" : "Add Brochure"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Samsung WindFree Brochure"
              />
            </div>
            <div>
              <Label>Brand / Supplier</Label>
              <Input
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="e.g. Samsung"
              />
            </div>
            <div>
              <Label>Model Match Prefixes (comma-separated)</Label>
              <Input
                value={form.model_match_prefixes_text}
                onChange={(e) => setForm({ ...form, model_match_prefixes_text: e.target.value })}
                placeholder="e.g. AR09, AR12, Samsung 18K"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Quote line items matching any prefix will auto-attach this brochure to the PDF
              </p>
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
              />
              <Label>Active</Label>
            </div>
            <div>
              <Label>PDF File {!editingId && "*"}</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="block w-full text-sm mt-1 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
              {editingId && (
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to keep the existing file
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={uploading}>
              {uploading ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="sm:max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Brochure Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <iframe src={previewUrl} className="w-full h-full rounded border" title="Brochure preview" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminBrochuresPage;
