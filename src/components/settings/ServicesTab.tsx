import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Save } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ServicesTab = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newService, setNewService] = useState({ name: "", category: "installation", default_price: 0, unit: "each" });

  const { data: services = [], isLoading } = useQuery({
    queryKey: ["hvac-services"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hvac_services").select("*").order("category").order("name");
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (svc: typeof newService) => {
      const { error } = await supabase.from("hvac_services").insert(svc);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hvac-services"] });
      toast({ title: "Service added ✅" });
      setDialogOpen(false);
      setNewService({ name: "", category: "installation", default_price: 0, unit: "each" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hvac_services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hvac-services"] });
      toast({ title: "Service removed" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("hvac_services").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hvac-services"] }),
  });

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">HVAC Services Catalog</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Service</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Service</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Name</Label><Input value={newService.name} onChange={(e) => setNewService((p) => ({ ...p, name: e.target.value }))} /></div>
              <div>
                <Label>Category</Label>
                <Select value={newService.category} onValueChange={(v) => setNewService((p) => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="installation">Installation</SelectItem>
                    <SelectItem value="repair">Repair</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="consultation">Consultation</SelectItem>
                    <SelectItem value="parts">Parts</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Default Price (ZAR)</Label><Input type="number" value={newService.default_price} onChange={(e) => setNewService((p) => ({ ...p, default_price: parseFloat(e.target.value) || 0 }))} /></div>
              <div><Label>Unit</Label><Input value={newService.unit} onChange={(e) => setNewService((p) => ({ ...p, unit: e.target.value }))} /></div>
              <Button onClick={() => createMutation.mutate(newService)} disabled={!newService.name || createMutation.isPending} className="w-full">
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Service
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((svc) => (
                <TableRow key={svc.id}>
                  <TableCell className="font-medium">{svc.name}</TableCell>
                  <TableCell><Badge variant="outline">{svc.category}</Badge></TableCell>
                  <TableCell className="text-right">R {Number(svc.default_price).toFixed(2)}</TableCell>
                  <TableCell>{svc.unit}</TableCell>
                  <TableCell>
                    <Badge
                      variant={svc.is_active ? "default" : "secondary"}
                      className="cursor-pointer"
                      onClick={() => toggleActive.mutate({ id: svc.id, is_active: !svc.is_active })}
                    >
                      {svc.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(svc.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {services.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No services configured yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default ServicesTab;
