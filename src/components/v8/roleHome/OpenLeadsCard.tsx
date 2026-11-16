import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OPEN_LEAD_STALE_DAYS, type OpenLeadRow } from "@/lib/yardView";
import { Glass } from "./chrome";

export type OpenLeadActions = {
  canArchive?: (row: OpenLeadRow) => boolean;
  onSend?: (row: OpenLeadRow) => void;
  onMarkSent?: (row: OpenLeadRow) => void;
  onArchive?: (row: OpenLeadRow) => void;
  onArchiveStale?: (rows: OpenLeadRow[]) => void;
  /** Harness: keep this row's menu open for a screenshot. */
  forceMenuId?: string | null;
};

const SEND_STATUS = new Set(["draft", "sent", "viewed", "expired"]);

function canSend(row: OpenLeadRow): boolean {
  return row.kind === "quote" && !!row.quoteId && SEND_STATUS.has(String(row.docStatus || "draft").toLowerCase());
}

function canMarkSent(row: OpenLeadRow): boolean {
  return row.kind === "quote" && !!row.quoteId && String(row.docStatus || "").toLowerCase() === "draft";
}

export function OpenLeadsCard({ rows, actions }: { rows: OpenLeadRow[]; actions?: OpenLeadActions }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const allow = (row: OpenLeadRow) => (actions?.canArchive ? actions.canArchive(row) : true);
  const stale = rows.filter((row) => row.stale && allow(row));
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
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md" data-testid="archive-old-confirm">
          <DialogHeader>
            <DialogTitle>Archive {stale.length} old lead{stale.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              These have had no activity for more than {OPEN_LEAD_STALE_DAYS} days. They leave this list. Nothing is deleted, and no email or WhatsApp is sent. You can restore a quote from Archived on the quotes list.
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
