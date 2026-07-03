import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultLeadId?: string;
  defaultQuoteId?: string;
  defaultCustomerId?: string;
}

const CreateJobDialog = ({ open, onOpenChange, defaultLeadId, defaultQuoteId, defaultCustomerId }: Props) => {
  const { companyId } = useUserCompanyId();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState(defaultCustomerId || "");
  const [leadId, setLeadId] = useState(defaultLeadId || "");
  const [quoteId, setQuoteId] = useState(defaultQuoteId || "");
  const [address, setAddress] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [duration, setDuration] = useState("2");
  const [priority, setPriority] = useState("normal");
  const [jobType, setJobType] = useState("service");

  const { data: customers = [] } = useQuery({
    queryKey: ["job-customers", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, name, address").order("name");
      return data || [];
    },
    enabled: open && !!companyId,
  });

  // Auto-fill address when customer changes
  useEffect(() => {
    if (customerId) {
      const cust = customers.find((c: any) => c.id === customerId);
      if (cust?.address && !address) setAddress(cust.address);
    }
  }, [customerId, customers]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const userId = user?.id;
      const { data, error } = await supabase.from("jobs").insert({
        company_id: companyId!,
        title,
        description: description || null,
        customer_id: customerId || null,
        lead_id: leadId || null,
        quote_id: quoteId || null,
        address: address || null,
        scheduled_for: scheduledFor || null,
        estimated_duration: `${duration} hours`,
        priority,
        job_type: jobType,
        created_by: userId || null,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Job created", description: "Now visible in Dispatch, Schedule, My Jobs and Map." });
      // Invalidate every view that shows jobs/leads/schedules
      ["jobs-list","jobs-dispatch","my-jobs","job-schedules","dispatch-leads","dispatch-schedules","dispatch-agents","admin-home-stats","jobs-kpi-stats","leads","leads-map"]
        .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
      resetForm();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create job", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCustomerId("");
    setLeadId("");
    setQuoteId("");
    setAddress("");
    setScheduledFor("");
    setDuration("2");
    setPriority("normal");
    setJobType("service");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
          <DialogDescription>Fill in the job details below</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. AC Installation - Unit 3" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Job details..." rows={3} />
          </div>
          <div>
            <Label>Job Type</Label>
            <Select value={jobType} onValueChange={setJobType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="installation">Installation</SelectItem>
                <SelectItem value="service">Service</SelectItem>
                <SelectItem value="repair">Repair</SelectItem>
                <SelectItem value="survey">Survey</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {customers.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Address</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Job address" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Scheduled Date/Time</Label>
              <Input type="datetime-local" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
            </div>
            <div>
              <Label>Estimated Duration (hrs)</Label>
              <Input type="number" min="0.5" step="0.5" value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!title || !companyId || createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateJobDialog;
