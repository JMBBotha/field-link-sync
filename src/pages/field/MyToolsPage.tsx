import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import ToolDetail, { StatusPill } from "@/components/tools/ToolDetail";
import { useToolTypes, useTools } from "@/components/tools/api";
import { fmtDate } from "@/lib/companyTools";

/** Tech view: the tools issued to me, read-only, with Report broken / Report lost. RLS only returns my own tools. */
export default function MyToolsPage() {
  const { user } = useAuth();
  const { data: tools = [], isLoading, error } = useTools({ mine: user?.id });
  const { data: types = [] } = useToolTypes();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = tools.find((t) => t.id === openId);
  if (open) return <div className="mx-auto max-w-md p-4"><button className="mb-2 text-sm font-semibold text-[#1590d6]" onClick={() => setOpenId(null)}>← My tools</button>
    <ToolDetail tool={open} type={types.find((t) => t.id === open.tool_type_id)} admin={false} /></div>;
  return (
    <div className="mx-auto max-w-md space-y-3 p-4" data-testid="my-tools-page">
      <h1 className="text-xl font-bold">My tools</h1>
      <p className="text-sm text-muted-foreground">Company tools issued to you. Tap one to report it broken or lost.</p>
      {error ? <p className="text-sm text-muted-foreground">Company tools aren't switched on yet.</p> : isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : !tools.length ? <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">No tools issued to you.</p>
        : tools.map((t) => (
          <button key={t.id} onClick={() => setOpenId(t.id)} className="flex w-full items-center justify-between rounded-xl border bg-white p-4 text-left shadow-sm">
            <div><div className="font-bold">{t.label} · {t.name}</div><div className="text-xs text-muted-foreground">{types.find((x) => x.id === t.tool_type_id)?.name} · since {fmtDate(t.status_date)}</div></div>
            <StatusPill s={t.status} /></button>))}
    </div>
  );
}
