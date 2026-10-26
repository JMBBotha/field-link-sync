import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Download, PencilRuler } from "lucide-react";

/** Off until the quote-drawing-download edge function is deployed (needs a Lovable credit). */
export const CLIENT_DRAWINGS_LINK_ENABLED = false;

type Row = { id: string; filename: string; kind: string };

/** Client quote link: included HVAC drawings (never BOQ). */
export default function ClientQuoteDrawings({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!CLIENT_DRAWINGS_LINK_ENABLED) return;
    supabase.rpc("public_quote_drawings" as never, { p_token: token } as never).then(({ data }) => setRows(((data as unknown) as Row[]) || []));
  }, [token]);
  if (!CLIENT_DRAWINGS_LINK_ENABLED || !rows.length) return null;
  const open = async (r: Row) => {
    const { data } = await supabase.functions.invoke("quote-drawing-download", { body: { token, id: r.id } });
    if (data?.url) window.location.href = data.url;
  };
  return (
    <Card className="rounded-2xl border-0 shadow-md print:hidden">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-semibold">Drawings</p>
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => void open(r)} className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted">
            <PencilRuler className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate flex-1">{r.filename}</span>
            <Download className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
