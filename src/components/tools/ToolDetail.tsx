import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS, ageDays, costText, eventLine, fmtDate, parseRands, type Tool, type ToolType } from "@/lib/companyTools";
import { openToolInvoice, rpc, uploadToolInvoice, useToolEvents, useToolsRefresh } from "./api";

type Act = null | "issue" | "return" | "broken" | "lost" | "retire" | "edit";
const card = "rounded-xl border bg-white p-4 shadow-sm";
export const StatusPill = ({ s }: { s: Tool["status"] }) => <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[s].cls}`}>{STATUS[s].label}</span>;

/** One tool: facts, history, and the actions the caller may take. Admin: issue/return/broken/lost/retire/edit. Tech: report broken/lost only. No delete anywhere. */
export default function ToolDetail({ tool, type, admin, techs = [], companyId, onClose }: {
  tool: Tool; type?: ToolType; admin: boolean; techs?: { id: string; full_name: string | null }[]; companyId?: string | null; onClose?: () => void;
}) {
  const refresh = useToolsRefresh();
  const { data: events = [] } = useToolEvents(tool.id);
  const [act, setAct] = useState<Act>(null);
  const [note, setNote] = useState(""); const [tech, setTech] = useState(""); const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState(tool.cost_cents != null ? String(tool.cost_cents / 100) : ""); const [tbc, setTbc] = useState(tool.cost_tbc);
  const ended = tool.status === "retired";
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setAct(null); setNote(""); await refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const confirm = () => {
    if (act === "issue") return run(() => rpc("issue_tool", { p_tool: tool.id, p_tech: tech, p_note: note || null }), `${tool.label} issued`);
    if (act === "return") return run(() => rpc("return_tool", { p_tool: tool.id, p_note: note || null }), `${tool.label} back in store`);
    if (act === "edit") return run(() => rpc("update_tool", { p_tool: tool.id, p_patch: { cost_cents: parseRands(cost), cost_tbc: tbc } }), "Cost saved");
    if (act === "retire") return run(() => rpc("set_tool_status", { p_tool: tool.id, p_status: "retired", p_note: note || null }), `${tool.label} retired`);
    if (act === "broken" || act === "lost") return admin && tool.status !== "in_use"
      ? run(() => rpc("set_tool_status", { p_tool: tool.id, p_status: act, p_note: note || null }), `${tool.label} marked ${act}`)
      : run(() => rpc("report_tool_issue", { p_tool: tool.id, p_kind: act, p_note: note || null }), act === "lost" ? "Reported lost. The owner has been told." : "Reported broken");
  };
  const attach = async (f?: File | null) => {
    if (!f || !companyId) return;
    await run(() => uploadToolInvoice(companyId, [tool.id], f), "Invoice attached");
  };
  const rows: [string, React.ReactNode][] = [
    ["Label", <b key="l">{tool.label}</b>], ["Bought", fmtDate(tool.purchase_date)], ["Cost", costText(tool)],
    ["Invoice", tool.invoice_path ? <button key="i" className="font-semibold text-[#1590d6] underline" onClick={() => openToolInvoice(tool.invoice_path!).catch((e) => toast.error(e.message))}>View</button>
      : <span key="i" className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">To attach</span>],
    ["With", tool.assigned_tech_name ?? "—"], ["Age", ageDays(tool) == null ? "—" : `${ageDays(tool)} days`],
    ...(tool.notes ? [["Notes", tool.notes] as [string, React.ReactNode]] : []),
  ];
  return (
    <div className="space-y-3" data-testid="tool-detail">
      <div className={card}>
        <div className="flex items-start justify-between gap-2"><div><h2 className="text-xl font-bold">{tool.label} · {tool.name}</h2>
          <p className="text-sm text-muted-foreground">{type?.name ?? "Tool"}{tool.supplier_name ? ` · ${tool.supplier_name}` : ""}</p></div>
          {onClose && <button className="text-sm text-muted-foreground" onClick={onClose} aria-label="Close">✕</button>}</div>
        <div className="mt-2"><StatusPill s={tool.status} /></div>
      </div>
      {admin && !ended && !act && (tool.status === "in_store" ? <Button className="h-12 w-full bg-[#C2410C] text-base hover:bg-[#a3370a]" onClick={() => setAct("issue")}>Issue to tech</Button>
        : tool.status === "in_use" ? <Button className="h-12 w-full bg-[#C2410C] text-base hover:bg-[#a3370a]" onClick={() => setAct("return")}>Return to store</Button> : null)}
      {act && (
        <div className="rounded-xl border-2 border-dashed bg-white p-4" data-testid="tool-action">
          <h3 className="font-bold">{{ issue: "Issue to tech", return: "Return to store", broken: "Report broken", lost: "Report lost", retire: "Retire tool", edit: "Edit cost" }[act]}</h3>
          {act === "issue" && <select className="mt-2 h-10 w-full rounded-md border px-2" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Tech">
            <option value="">Choose tech…</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select>}
          {act === "edit" ? <div className="mt-2 flex items-center gap-2"><Input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Cost (R)" inputMode="decimal" />
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={tbc} onChange={(e) => setTbc(e.target.checked)} /> TBC</label></div>
            : <Input className="mt-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder={act === "lost" ? "Where / when last seen (optional)" : "Note (optional)"} />}
          <p className="mt-1 text-xs text-muted-foreground">Date: today · Logged as you{act === "lost" ? " · the owner gets an in-app alert" : ""}{act === "retire" ? " · retired is final, the history stays" : ""}</p>
          <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setAct(null)}>Cancel</Button>
            <Button className="bg-[#C2410C] hover:bg-[#a3370a]" disabled={busy || (act === "issue" && !tech)} onClick={confirm}>Confirm</Button></div>
        </div>
      )}
      <div className={card}><dl className="divide-y text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl>
        {admin && !ended && <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAct("edit")}>Edit cost</Button>
          {companyId && <label className="inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium">{tool.invoice_path ? "Replace invoice" : "Attach invoice"}
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => attach(e.target.files?.[0])} /></label>}
        </div>}
      </div>
      <div className={card}><h3 className="font-bold">History</h3>
        <ul className="mt-1 space-y-1 text-sm text-muted-foreground" data-testid="tool-history">{events.length ? events.map((e) => <li key={e.id}>{fmtDate(e.event_date)} · {eventLine(e)}</li>) : <li>No history yet</li>}</ul></div>
      {!ended && !act && (admin || tool.status === "in_use") && (
        <div className="grid grid-cols-3 gap-2">
          {tool.status !== "broken" && <Button variant="outline" onClick={() => setAct("broken")}>{admin ? "Mark broken" : "Report broken"}</Button>}
          {tool.status !== "lost" && <Button variant="outline" onClick={() => setAct("lost")}>{admin ? "Mark lost" : "Report lost"}</Button>}
          {admin && <Button variant="outline" onClick={() => setAct("retire")}>Retire</Button>}
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">{admin ? "Tools are never deleted. Retire keeps the history." : "Only the office can change tool details."}</p>
    </div>
  );
}
