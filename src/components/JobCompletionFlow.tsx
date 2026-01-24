import { useState, useEffect } from "react";
import { Wrench, Plus, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import EquipmentForm from "./EquipmentForm";

interface Equipment {
  id: string;
  type: string;
  brand: string;
  model: string | null;
  location: string | null;
}

interface JobCompletionFlowProps {
  leadId: string;
  customerId: string | null;
  open: boolean;
  onClose: () => void;
  onComplete: (equipmentId: string | null) => void;
}

const equipmentTypeLabels: Record<string, string> = {
  ac: "AC",
  heater: "Heater",
  vent: "Vent",
  heat_pump: "Heat Pump",
  furnace: "Furnace",
  other: "Other",
};

const JobCompletionFlow = ({ leadId, customerId, open, onClose, onComplete }: JobCompletionFlowProps) => {
  const { toast } = useToast();
  const [step, setStep] = useState<"choice" | "select" | "add">("choice");
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>("");
  const [showEquipmentForm, setShowEquipmentForm] = useState(false);

  useEffect(() => {
    if (open && customerId) {
      fetchEquipment();
    }
  }, [open, customerId]);

  const fetchEquipment = async () => {
    if (!customerId) return;
    
    const { data } = await supabase
      .from("equipment" as any)
      .select("id, type, brand, model, location")
      .eq("customer_id", customerId);

    setEquipment((data as unknown as Equipment[]) || []);
  };

  const handleChoice = (choice: "existing" | "new" | "skip") => {
    if (choice === "existing") {
      if (equipment.length === 0) {
        toast({
          title: "No Equipment",
          description: "No equipment recorded for this customer. Add a new unit.",
        });
        setStep("add");
      } else {
        setStep("select");
      }
    } else if (choice === "new") {
      setStep("add");
      setShowEquipmentForm(true);
    } else {
      // Skip - complete without equipment
      onComplete(null);
    }
  };

  const handleSelectEquipment = async () => {
    if (!selectedEquipmentId) {
      toast({
        title: "Select Equipment",
        description: "Please select the equipment you worked on",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    // Update last_service_date on the equipment
    await supabase
      .from("equipment" as any)
      .update({ 
        last_service_date: new Date().toISOString().split("T")[0],
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedEquipmentId);

    setLoading(false);
    onComplete(selectedEquipmentId);
  };

  const handleEquipmentAdded = async () => {
    // Refresh equipment list
    await fetchEquipment();
    setShowEquipmentForm(false);
    
    // If there's now equipment, go to select step
    setStep("select");
  };

  if (!open) return null;

  return (
    <>
      <Sheet open={open && !showEquipmentForm} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <SheetContent 
          side="bottom" 
          className="h-auto max-h-[70vh] rounded-t-2xl border-t bg-card/95 backdrop-blur-md"
        >
          <div className="flex justify-center pt-2 pb-3">
            <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full" />
          </div>

          <SheetHeader className="pb-4">
            <SheetTitle className="text-lg font-bold text-center">
              {step === "choice" && "Did you work on equipment?"}
              {step === "select" && "Select Equipment"}
              {step === "add" && "Add Equipment"}
            </SheetTitle>
          </SheetHeader>

          <div className="pb-6 space-y-4">
            {/* Choice Step */}
            {step === "choice" && (
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full h-14 justify-start gap-3 rounded-xl"
                  onClick={() => handleChoice("existing")}
                >
                  <Wrench className="h-5 w-5 text-[#0077B6]" />
                  <div className="text-left">
                    <p className="font-medium">Existing Equipment</p>
                    <p className="text-xs text-muted-foreground">
                      Worked on a unit already on file
                    </p>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-14 justify-start gap-3 rounded-xl"
                  onClick={() => handleChoice("new")}
                >
                  <Plus className="h-5 w-5 text-[#0077B6]" />
                  <div className="text-left">
                    <p className="font-medium">New Installation</p>
                    <p className="text-xs text-muted-foreground">
                      Installed a new unit
                    </p>
                  </div>
                </Button>

                <Button
                  variant="ghost"
                  className="w-full h-10 text-muted-foreground"
                  onClick={() => handleChoice("skip")}
                >
                  Skip - No equipment involved
                </Button>
              </div>
            )}

            {/* Select Equipment Step */}
            {step === "select" && (
              <div className="space-y-4">
                <RadioGroup value={selectedEquipmentId} onValueChange={setSelectedEquipmentId}>
                  {equipment.map((eq) => (
                    <div
                      key={eq.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        selectedEquipmentId === eq.id 
                          ? "border-[#0077B6] bg-[#0077B6]/10" 
                          : "hover:bg-accent/50"
                      }`}
                      onClick={() => setSelectedEquipmentId(eq.id)}
                    >
                      <RadioGroupItem value={eq.id} id={eq.id} />
                      <Label htmlFor={eq.id} className="flex-1 cursor-pointer">
                        <p className="font-medium">
                          {eq.brand} {eq.model || ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {equipmentTypeLabels[eq.type] || eq.type}
                          {eq.location && ` • ${eq.location}`}
                        </p>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setShowEquipmentForm(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Equipment
                </Button>

                <Button
                  className="w-full h-11 rounded-full font-semibold"
                  style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                  onClick={handleSelectEquipment}
                  disabled={loading || !selectedEquipmentId}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Continue with Selected
                </Button>

                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => setStep("choice")}
                >
                  Back
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Equipment Form */}
      {customerId && (
        <EquipmentForm
          customerId={customerId}
          open={showEquipmentForm}
          onClose={() => setShowEquipmentForm(false)}
          onSuccess={handleEquipmentAdded}
        />
      )}
    </>
  );
};

export default JobCompletionFlow;