import { useState, useEffect } from "react";
import { Plus, Wrench, Calendar, MapPin, ChevronRight, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import EquipmentForm from "./EquipmentForm";

interface Equipment {
  id: string;
  type: string;
  brand: string;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  warranty_expiry: string | null;
  location: string | null;
  last_service_date: string | null;
  notes: string | null;
}

interface EquipmentListProps {
  customerId: string;
  onSelectEquipment?: (equipment: Equipment) => void;
  compact?: boolean;
}

const equipmentTypeLabels: Record<string, string> = {
  ac: "Air Conditioner",
  heater: "Heater",
  vent: "Ventilation",
  heat_pump: "Heat Pump",
  furnace: "Furnace",
  other: "Other",
};

const equipmentTypeIcons: Record<string, string> = {
  ac: "❄️",
  heater: "🔥",
  vent: "💨",
  heat_pump: "🔄",
  furnace: "♨️",
  other: "⚙️",
};

const isWarrantyExpired = (expiryDate: string | null): boolean => {
  if (!expiryDate) return false;
  return new Date(expiryDate) < new Date();
};

const isWarrantyExpiringSoon = (expiryDate: string | null): boolean => {
  if (!expiryDate) return false;
  const expiry = new Date(expiryDate);
  const threeMonths = new Date();
  threeMonths.setMonth(threeMonths.getMonth() + 3);
  return expiry > new Date() && expiry < threeMonths;
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const EquipmentList = ({ customerId, onSelectEquipment, compact = false }: EquipmentListProps) => {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);

  useEffect(() => {
    fetchEquipment();
  }, [customerId]);

  const fetchEquipment = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("equipment" as "leads")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching equipment:", error);
    } else {
      setEquipment((data as unknown as Equipment[]) || []);
    }
    setLoading(false);
  };

  const handleEdit = (eq: Equipment) => {
    setEditingEquipment(eq);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingEquipment(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-[#0077B6]" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Equipment ({equipment.length})</span>
        </div>
        <Button
          size="sm"
          className="h-8 rounded-full"
          style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
          onClick={() => setShowForm(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {/* Equipment List */}
      {equipment.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg bg-background/50">
          <Wrench className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No equipment recorded</p>
          <Button
            variant="link"
            size="sm"
            className="mt-1"
            style={{ color: '#0077B6' }}
            onClick={() => setShowForm(true)}
          >
            Add first unit
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {equipment.map((eq) => (
            <Card
              key={eq.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => onSelectEquipment ? onSelectEquipment(eq) : handleEdit(eq)}
            >
              <CardContent className={compact ? "p-3" : "p-4"}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{equipmentTypeIcons[eq.type] || "⚙️"}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">
                          {eq.brand} {eq.model || ""}
                        </p>
                        {isWarrantyExpired(eq.warranty_expiry) && (
                          <Badge variant="destructive" className="text-xs">
                            Warranty Expired
                          </Badge>
                        )}
                        {isWarrantyExpiringSoon(eq.warranty_expiry) && (
                          <Badge className="text-xs bg-orange-500 text-white">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Expiring Soon
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {equipmentTypeLabels[eq.type] || eq.type}
                      </p>
                      {!compact && (
                        <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                          {eq.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {eq.location}
                            </span>
                          )}
                          {eq.last_service_date && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Last service: {formatDate(eq.last_service_date)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Equipment Form */}
      <EquipmentForm
        customerId={customerId}
        open={showForm}
        onClose={handleFormClose}
        onSuccess={fetchEquipment}
        existingEquipment={editingEquipment}
      />
    </div>
  );
};

export default EquipmentList;