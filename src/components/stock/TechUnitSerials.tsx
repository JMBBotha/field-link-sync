import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sb } from "@/components/supplierDocs/api";

type UnitRow = { id: string; half: string | null; supplier_code: string | null; serial_no: string | null; label: string };

/** Tech confirms the serial on each unit booked to this job. No prices. */
export default function TechUnitSerials({ jobId }: { jobId: string }) {
  const { data, error, refetch } = useQuery({
    queryKey: ["job-units-for-tech", jobId],
    enabled: !!jobId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await sb.rpc("job_units_for_tech", { p_job: jobId });
      if (error) throw error;
      return (data ?? []) as UnitRow[];
    },
  });
  if (error || !data?.length) return null;
  return (
    <Card className="rounded-2xl" data-testid="tech-unit-serials">
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="font-semibold">Units on this job</h3>
          <p className="text-xs text-muted-foreground">Confirm the serial on each indoor and outdoor unit. Materials are handled by the office allowance when you finish.</p>
        </div>
        {data.map((u) => <SerialRow key={u.id} unit={u} onSaved={() => refetch()} />)}
      </CardContent>
    </Card>
  );
}

function SerialRow({ unit, onSaved }: { unit: UnitRow; onSaved: () => void }) {
  const [serial, setSerial] = useState(unit.serial_no ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc("job_confirm_unit_serial", { p_unit: unit.id, p_serial: serial.trim() });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setMsg("Saved");
    onSaved();
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="min-w-0 sm:w-40">
        <div className="text-sm font-medium">{unit.half === "outdoor" ? "Outdoor" : unit.half === "indoor" ? "Indoor" : "Unit"}</div>
        <div className="truncate text-xs text-muted-foreground">{unit.supplier_code || unit.label}</div>
      </div>
      <Input aria-label={`Serial for ${unit.supplier_code || unit.label}`} value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial number" className="h-11" />
      <Button type="button" variant="outline" className="h-11" disabled={busy || !serial.trim()} onClick={save}>{busy ? "Saving…" : "Confirm serial"}</Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
