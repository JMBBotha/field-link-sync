import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SENT_CHANNELS } from "@/components/documents/MarkSentManually";
import { bulkSendLine, markSentSplit, sendableLines, type BulkSendLine } from "@/lib/openLeadBulk";
import { reasonOk } from "@/lib/quoteDeleteArchive";
import { OPEN_LEAD_STALE_DAYS, type OpenLeadRow } from "@/lib/yardView";
import { Glass } from "./chrome";

export type OpenLeadActions = {
  canArchive?: (row: OpenLeadRow) => boolean;
  onSend?: (row: OpenLeadRow) => void;
  onMarkSent?: (row: OpenLeadRow) => void;
  onArchive?: (row: OpenLeadRow) => void;
  onArchiveStale?: (rows: OpenLeadRow[]) => void;
  onBulkMarkSent?: (drafts: OpenLeadRow[], channel: string) => Promise<void> | void;
  onBulkArchive?: (rows: OpenLeadRow[], reason: string) => Promise<void> | void;
  prepareBulkSend?: (rows: OpenLeadRow[]) => Promise<BulkSendLine[]>;
  confirmBulkSend?: (lines: BulkSendLine[]) => Promise<{ customer: string; ok: boolean; detail: string }[]>;
  /** Harness: keep this row's menu open for a screenshot. */
  forceMenuId?: string | null;
  /** Harness: start with these rows ticked. */
  initialSelected?: string[];
  /** Harness: open the send review with these lines. Nothing is emailed. */
  previewReview?: BulkSendLine[];
};

const SEND_STATUS = new Set(["draft", "sent", "viewed", "expired"]);

function canSend(row: OpenLeadRow): boolean {
  return row.kind === "quote" && !!row.quoteId && SEND_STATUS.has(String(row.docStatus || "draft").toLowerCase());
}

function canMarkSent(row: OpenLeadRow): boolean {
  return row.kind === "quote" && !!row.quoteId && String(row.docStatus || "").toLowerCase() === "draft";
}

export function OpenLeadsCard({ rows, actions, warnDays = OPEN_LEAD_STALE_DAYS }: { rows: OpenLeadRow[]; actions?: OpenLeadActions; warnDays?: number }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [picked, setPicked] = useState<string[]>(actions?.initialSelected || []);
  const [markOpen, setMarkOpen] = useState(false);
  const [channel, setChannel] = useState("email");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [review, setReview] = useState<BulkSendLine[] | null>(actions?.previewReview || null);
  const [results, setResults] = useState<{ customer: string; ok: boolean; detail: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (actions?.initialSelected) setPicked(actions.initialSelected); }, [actions?.initialSelected?.join("|")]);
  const allow = (row: OpenLeadRow) => (actions?.canArchive ? actions.canArchive(row) : true);
  const stale = rows.filter((row) => row.stale && allow(row));
  const selected = rows.filter((row) => picked.includes(row.id));
  const allOn = rows.length > 0 && selected.length === rows.length;
  const split = markSentSplit(selected);
  const archivable = selected.filter(allow);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const clearPick = () => setPicked([]);
  const runMark = async () => {
    setBusy(true);
    try { await actions?.onBulkMarkSent?.(split.drafts, channel); setMarkOpen(false); clearPick(); }
    finally { setBusy(false); }
  };
  const runArchive = async () => {
    setBusy(true);
    try { await actions?.onBulkArchive?.(archivable, archiveReason.trim()); setArchiveOpen(false); clearPick(); }
    finally { setBusy(false); }
  };
  const openReview = async () => {
    setResults(null);
    if (actions?.prepareBulkSend) setReview(await actions.prepareBulkSend(selected));
    else setReview(selected.map((row) => bulkSendLine(row)));
  };
  const runSend = async () => {
    const lines = sendableLines(review || []);
    if (!actions?.confirmBulkSend) { setResults(lines.map((line) => ({ customer: line.customer, ok: false, detail: "Preview only — nothing was emailed" }))); return; }
    setBusy(true);
    try {
      const out = await actions.confirmBulkSend(lines);
      setResults(out);
      clearPick();
    } finally { setBusy(false); }
  };
  const stop = (event: { stopPropagation: () => void; preventDefault?: () => void }) => {
    event.stopPropagation();
  };
  const archiveStale = () => {
    setConfirm(false);
    actions?.onArchiveStale?.(stale);
  };
  return (
    <Glass testId="open-leads-section">
      <div className="rh-head" style={{ flexWrap: "wrap" }}>
        <h2>Open leads</h2>
        <span className="home-job-tools">
          {rows.length > 0 && (
            <label className="open-lead-selectall" data-testid="open-leads-select-all">
              <Checkbox data-no-min checked={allOn ? true : selected.length > 0 ? "indeterminate" : false} onCheckedChange={(v) => setPicked(v === true ? rows.map((row) => row.id) : [])} aria-label="Select all visible" />
              <span>Select all visible</span>
              {selected.length > 0 && <b data-testid="open-leads-selected-count">{selected.length} selected</b>}
            </label>
          )}
          {stale.length > 0 && (
            <button type="button" className="open-lead-archive" data-testid="archive-old-leads" onClick={() => setConfirm(true)}>
              Archive {stale.length} old lead{stale.length === 1 ? "" : "s"}
            </button>
          )}
          <Link to="/admin/quotes?status=archived" className="home-yard-link" data-testid="open-leads-archived">Archived</Link>
          <span className="rh-count" data-testid="open-leads-count">{rows.length}</span>
        </span>
      </div>
      {rows.length === 0 && <p className="rh-muted" data-testid="open-leads-empty">There are no open leads.</p>}
      {rows.map((row) => {
        const send = canSend(row);
        const mark = canMarkSent(row);
        const archive = allow(row);
        return (
          <div key={row.id} className="rh-row open-lead-line">
            <Checkbox data-no-min className="mt-1" data-testid="open-lead-tick" checked={picked.includes(row.id)} onCheckedChange={() => toggle(row.id)} aria-label={`Select ${row.customer}`} onClick={stop} />
            <Link to={row.href} className="open-lead-main" data-testid="open-lead-row">
              <b>{row.customer}</b>
              <div className="rh-muted">{row.stage}{row.typeLabel ? ` · ${row.typeLabel}` : ""}</div>
              {(row.quoteRef || row.amountLabel) && <div className="rh-muted">{[row.quoteRef, row.amountLabel].filter(Boolean).join(" · ")}</div>}
              {row.stale && <div className="rh-old" data-testid="open-lead-old">Old — archive?</div>}
            </Link>
            <div className="open-lead-tools" onClick={stop} onKeyDown={stop}>
              {send && (
                <button type="button" className="open-lead-quick" data-testid="open-lead-send" onClick={() => actions?.onSend?.(row)}>Send</button>
              )}
              {mark && (
                <button type="button" className="open-lead-quick" data-testid="open-lead-mark-sent" onClick={() => actions?.onMarkSent?.(row)}>Mark sent</button>
              )}
              {archive && (
                <button type="button" className="open-lead-quick danger" data-testid="open-lead-archive" onClick={() => actions?.onArchive?.(row)}>Archive</button>
              )}
              <DropdownMenu modal={false} open={actions?.forceMenuId === row.id ? true : undefined}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${row.customer}`} data-testid="open-lead-menu">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" data-testid="open-lead-menu-list">
                  {send && <DropdownMenuItem data-testid="open-lead-menu-send" onSelect={() => actions?.onSend?.(row)}>Send</DropdownMenuItem>}
                  {mark && <DropdownMenuItem data-testid="open-lead-menu-mark-sent" onSelect={() => actions?.onMarkSent?.(row)}>Mark as sent</DropdownMenuItem>}
                  {archive && <DropdownMenuItem data-testid="open-lead-menu-archive" onSelect={() => actions?.onArchive?.(row)}>Archive</DropdownMenuItem>}
                  {(send || mark || archive) && <DropdownMenuSeparator />}
                  <DropdownMenuItem data-testid="open-lead-menu-open" onSelect={() => navigate(row.href)}>Open</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
      {selected.length > 0 && (
        <div className="open-lead-bulk" data-testid="open-lead-bulk">
          <b>{selected.length} selected</b>
          <button type="button" className="open-lead-quick" style={{ display: "inline-flex" }} data-testid="bulk-mark-sent" onClick={() => { setChannel("email"); setMarkOpen(true); }}>Mark sent</button>
          {archivable.length > 0 && (
            <button type="button" className="open-lead-archive" data-testid="bulk-archive" onClick={() => { setArchiveReason(""); setArchiveOpen(true); }}>Archive</button>
          )}
          <button type="button" className="open-lead-archive" data-testid="bulk-send" onClick={() => void openReview()}>Send</button>
          <button type="button" className="open-lead-quick" style={{ display: "inline-flex" }} data-testid="bulk-clear" onClick={clearPick}>Clear selection</button>
        </div>
      )}
      <Dialog open={markOpen} onOpenChange={setMarkOpen}>
        <DialogContent className="sm:max-w-md" data-testid="bulk-mark-dialog">
          <DialogHeader>
            <DialogTitle>Mark drafts as sent?</DialogTitle>
            <DialogDescription>{split.drafts.length} of {selected.length} are drafts. The others stay as they are. Nothing is emailed.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {SENT_CHANNELS.map((item) => (
              <Button key={item.k} type="button" size="sm" variant={channel === item.k ? "default" : "outline"} onClick={() => setChannel(item.k)}>{item.label}</Button>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setMarkOpen(false)}>Cancel</Button>
            <Button className="bg-[#C2410C] text-white hover:bg-[#9a3412]" disabled={split.drafts.length === 0 || busy} data-testid="bulk-mark-confirm" onClick={() => void runMark()}>Mark {split.drafts.length} sent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={archiveOpen} onOpenChange={(next) => { if (!busy) setArchiveOpen(next); }}>
        <DialogContent className="sm:max-w-md" data-testid="bulk-archive-dialog">
          <DialogHeader>
            <DialogTitle>Archive {archivable.length} selected?</DialogTitle>
            <DialogDescription>One reason covers every ticked lead you are allowed to archive. The rest stay. Nothing is deleted or emailed. Undo puts them all back.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <Label htmlFor="bulk-archive-reason">Reason</Label>
            <Textarea id="bulk-archive-reason" rows={2} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} placeholder="e.g. No reply" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button className="bg-[#C2410C] text-white hover:bg-[#9a3412]" disabled={!reasonOk(archiveReason) || busy} data-testid="bulk-archive-confirm" onClick={() => void runArchive()}>Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!review} onOpenChange={(next) => { if (!next && !busy) { setReview(null); setResults(null); } }}>
        <DialogContent className="sm:max-w-lg" data-testid="bulk-send-review">
          <DialogHeader>
            <DialogTitle>Send these quotes?</DialogTitle>
            <DialogDescription>Nothing is emailed until you confirm. Each quote uses the same send as a single quote. Rows without an email are skipped.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-2 overflow-auto text-sm">
            {(review || []).map((line) => (
              <li key={line.id} data-testid="bulk-send-line" className="rounded-md border px-2 py-1.5">
                <b>{line.customer}</b>
                <div className="text-muted-foreground">{[line.quoteRef, line.amountLabel].filter(Boolean).join(" · ") || "No quote"}</div>
                <div>{line.email || "No email"}{line.phone ? ` · ${line.phone}` : " · No phone"}</div>
                {line.block && <div className="font-semibold text-[#9a3412]" data-testid="bulk-send-block">{line.block}</div>}
              </li>
            ))}
          </ul>
          {results && (
            <ul className="space-y-1 text-sm" data-testid="bulk-send-results">
              {results.map((item) => <li key={item.customer}>{item.ok ? "Sent" : "Not sent"} · {item.customer} · {item.detail}</li>)}
            </ul>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy} onClick={() => { setReview(null); setResults(null); }}>Close</Button>
            <Button className="bg-[#C2410C] text-white hover:bg-[#9a3412]" disabled={busy || sendableLines(review || []).length === 0 || !!results} data-testid="bulk-send-confirm" onClick={() => void runSend()}>Send {sendableLines(review || []).length}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md" data-testid="archive-old-confirm">
          <DialogHeader>
            <DialogTitle>Archive {stale.length} old lead{stale.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              These have had no activity for more than {warnDays} days. They leave this list. Nothing is deleted, and no email or WhatsApp is sent. You can restore a quote from Archived on the quotes list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button className="bg-[#C2410C] text-white hover:bg-[#9a3412]" data-testid="archive-old-confirm-yes" onClick={archiveStale}>
              Archive {stale.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Glass>
  );
}
