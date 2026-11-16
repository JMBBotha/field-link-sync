import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { searchFirstFitHouses } from "@/lib/firstFitApi";

/** Phone list. A tech types a house number and opens that house. */
export default function FieldHousesPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ house_id: string; house_no: string; project_name: string; live: boolean }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const search = async (value: string) => {
    setQ(value);
    if (value.trim().length < 1) { setRows([]); return; }
    try {
      setErr(null);
      setRows(await searchFirstFitHouses(value.trim()));
    } catch (e: any) {
      setErr(e?.message || "Couldn't search houses");
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-3 p-4" data-testid="field-houses">
      <h1 className="text-xl font-semibold">Houses</h1>
      <p className="text-sm text-muted-foreground">Find a house and file the first-fit points. Photos stay on the house.</p>
      <Input value={q} onChange={(e) => void search(e.target.value)} placeholder="House number" className="h-12 text-base" autoFocus data-testid="house-search" />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <ul className="space-y-2">
        {rows.map((h) => (
          <li key={h.house_id}>
            <button type="button" onClick={() => navigate(`/field/house/${h.house_id}`)} className="flex h-14 w-full items-center justify-between rounded-2xl border bg-card px-4 text-left">
              <span><span className="font-semibold">House {h.house_no}</span><span className="block text-xs text-muted-foreground">{h.project_name}</span></span>
              {h.live && <span className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Live</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
