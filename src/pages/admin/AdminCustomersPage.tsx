import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import CustomerSearchSelector from "@/components/customers/CustomerSearchSelector";
import CreateCustomerDialog from "@/components/customers/CreateCustomerDialog";
import { type CustomerSearchResult } from "@/hooks/useCustomerSearch";
import { cn } from "@/lib/utils";
import {
  Users, Plus, User, Building2, Phone, MapPin, Mail,
} from "lucide-react";

const statusBadge: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  lead: "bg-amber-100 text-amber-700",
  inactive: "bg-muted text-muted-foreground",
};

const AdminCustomersPage = () => {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["all-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, first_name, last_name, company_name, is_company, phone, email, primary_address_line1, city, status, created_at")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Customers
          </h1>
          <p className="text-sm text-muted-foreground">{customers.length} customers in database</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Customer
        </Button>
      </div>

      {/* Search */}
      <CustomerSearchSelector
        value=""
        onSelect={(c) => navigate(`/admin/customers/${c.id}`)}
        onCreateNew={() => setShowCreate(true)}
        placeholder="Search customers by name, phone, email, address..."
      />

      {/* Customer List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((c) => {
            const name = c.is_company && c.company_name
              ? c.company_name
              : `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Unnamed";
            return (
              <Card
                key={c.id}
                className="cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => navigate(`/admin/customers/${c.id}`)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    {c.is_company ? <Building2 className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" />{c.phone}</span>
                      {c.email && <span className="flex items-center gap-0.5"><Mail className="h-3 w-3" />{c.email}</span>}
                      {c.primary_address_line1 && <span className="flex items-center gap-0.5 truncate"><MapPin className="h-3 w-3" />{c.primary_address_line1}</span>}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn("text-xs shrink-0", statusBadge[c.status || "lead"])}>
                    {c.status || "lead"}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCustomerDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(c) => navigate(`/admin/customers/${c.id}`)}
      />
    </div>
  );
};

export default AdminCustomersPage;
