/**
 * QuoteVersionsPanel — version history + lifecycle actions for a quote.
 * Wires the create_quote_version / accept_quote / create_change_order RPCs.
 */
import { useState } from "react";
import { CheckCircle2, FilePlus2, GitBranch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuoteVersions } from "@/hooks/useQuoteVersions";
import { formatRand } from "@/utils/formatRand";

interface Props {
  quoteId: string;
  status: string | null;
  acceptedVersionId?: string | null;
  currentVersionId?: string | null;
}

const QuoteVersionsPanel = ({ quoteId, status, acceptedVersionId, currentVersionId }: Props) => {
  const { versions, changeOrders, createVersion, acceptQuote, createChangeOrder } = useQuoteVersions(quoteId);
  const [acceptTarget, setAcceptTarget] = useState<string | null>(null);

  const isAccepted = String(status || "").toLowerCase() === "accepted" || !!acceptedVersionId;
  const list = versions.data ?? [];
  const latest = list[0];

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <GitBranch className="h-4 w-4 text-primary" /> Versions & change orders
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => createVersion.mutate()}
            disabled={createVersion.isPending || isAccepted}
            title={isAccepted ? "Accepted quotes are locked — raise a change order instead" : undefined}
          >
            {createVersion.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="mr-2 h-4 w-4" />
            )}
            New version
          </Button>
          <Button
            size="sm"
            variant="brand"
            onClick={() => latest && setAcceptTarget(latest.id)}
            disabled={!latest || isAccepted || acceptQuote.isPending}
            title={!latest ? "Create a version before accepting" : undefined}
          >
            {acceptQuote.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Accept
          </Button>
          {isAccepted && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => createChangeOrder.mutate()}
              disabled={createChangeOrder.isPending}
            >
              {createChangeOrder.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GitBranch className="mr-2 h-4 w-4" />
              )}
              Raise change order
            </Button>
          )}
        </div>
      </div>

      {versions.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading versions…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No versions yet. Create one to snapshot the current line items before sending.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground">v{v.version_number}</span>
                {v.id === acceptedVersionId && <Badge variant="default">Accepted</Badge>}
                {v.id === currentVersionId && v.id !== acceptedVersionId && (
                  <Badge variant="secondary">Current</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(v.created_at).toLocaleDateString("en-ZA")}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground">
                  {formatRand(Number(v.total_incl_vat) || 0)}
                </span>
                {!isAccepted && (
                  <Button size="sm" variant="ghost" onClick={() => setAcceptTarget(v.id)}>
                    Accept this
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(changeOrders.data?.length ?? 0) > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">Change orders</p>
          {changeOrders.data!.map((co) => (
            <div key={co.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-foreground">
                <Badge variant="outline">{co.status}</Badge>
                {co.reason || "No reason captured"}
              </span>
              <span className="text-muted-foreground">
                {formatRand(Number(co.total_impact_incl_vat) || 0)}
              </span>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!acceptTarget} onOpenChange={(o) => !o && setAcceptTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Accept this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Accepting locks the quote. Further changes must be made through a change order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (acceptTarget) acceptQuote.mutate(acceptTarget);
                setAcceptTarget(null);
              }}
            >
              Accept version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default QuoteVersionsPanel;
