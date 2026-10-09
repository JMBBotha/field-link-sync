import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";

/** Admin: which hand-off option is preselected when an accepted quote goes to a technician. */
export default function InstallHandoffSettingsCard() {
  const { companyId } = useUserCompanyId() as any;
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  useEffect(() => {
    if (!companyId) return;
    (supabase.from("companies") as any).select("install_handoff_default").eq("id", companyId).maybeSingle()
      .then(({ data }: any) => data?.install_handoff_default && setMode(data.install_handoff_default));
  }, [companyId]);
  const save = async (v: "manual" | "auto") => {
    setMode(v);
    const { error } = await (supabase as any).rpc("set_install_handoff_default", { p_mode: v });
    if (error) toast.error(error.message); else toast.success("Default installation hand-off saved");
  };
  return (
    <Card className="mt-4" data-testid="install-handoff-settings">
      <CardHeader><CardTitle className="text-base">Default installation hand-off</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        <Label className="text-xs">Preselected when an accepted quote is handed to a technician</Label>
        <Select value={mode} onValueChange={(v) => save(v as "manual" | "auto")}>
          <SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Pick technician</SelectItem>
            <SelectItem value="auto">Offer to my technicians (first to accept, 15 min)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Salespeople can only offer; they never pick a technician.</p>
      </CardContent>
    </Card>
  );
}
