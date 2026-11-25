import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { missingUnitImageMessage, type MissingUnitImage } from "@/lib/quoteUnitImages";
import { requestProductImages } from "@/lib/findProductImage";
import { useToast } from "@/hooks/use-toast";

/** Blocks Send and Email until every unit line has a photo, and can look the photos up. */
export default function MissingUnitImagesDialog({
  lines,
  onOpenChange,
  onDone,
}: {
  lines: MissingUnitImage[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const open = lines.length > 0;
  const names = lines.map((line) => line.name);
  const canSearch = lines.some((line) => line.productId);

  const find = async () => {
    const ids = lines.map((line) => line.productId).filter((id): id is string => !!id);
    if (!ids.length) {
      toast({ title: "No catalogue product", description: "These lines have no product to search. Add a photo on the catalogue item, or swap in a catalogue unit.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const results = await requestProductImages(ids, { retry: true });
      const blocked = results.find((row) => row.status === "not_configured");
      const failed = results.filter((row) => row.status === "not_found" || row.status === "error");
      if (blocked?.error) toast({ title: "Image search is not set up", description: blocked.error, variant: "destructive" });
      else if (failed.length) toast({ title: "Some photos were not found", description: failed.map((row) => row.error || row.reason || "No matching photo").filter(Boolean).slice(0, 3).join(" "), variant: "destructive" });
      await onDone();
    } catch (err) {
      toast({ title: "Could not look up photos", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="missing-unit-images">
        <DialogHeader>
          <DialogTitle>These units need a photo</DialogTitle>
          <DialogDescription>{missingUnitImageMessage(names, { hint: false })}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          {lines.map((line) => <li key={line.id} data-testid="missing-unit-image-line">{line.name}</li>)}
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          <Button type="button" variant="brand" data-testid="find-unit-images" onClick={() => void find()} disabled={busy || !canSearch}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Find images
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
