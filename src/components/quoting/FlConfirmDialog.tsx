import { useCallback, useRef, useState, type ReactNode } from "react";
import { Mail, RotateCcw, AlertTriangle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import "./fl-send.css";

type Tone = "brand" | "amber" | "red";
export type FlConfirmOptions = { title: string; body: ReactNode; confirmLabel: string; cancelLabel?: string; tone?: Tone };

/** Styled in-app confirm in the v8 look (replaces the browser's plain OK/Cancel). */
export function FlConfirmDialog({ open, onOpenChange, onConfirm, title, body, confirmLabel, cancelLabel = "Cancel", tone = "brand", testId }: FlConfirmOptions & {
  open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void; testId?: string;
}) {
  const Icon = tone === "red" ? AlertTriangle : tone === "amber" ? RotateCcw : Mail;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="fl-confirm sm:max-w-md" data-testid={testId}>
        <AlertDialogHeader className="text-left sm:text-left">
          <div className="flex items-start gap-3">
            <span className={`fl-confirm-icon tone-${tone}`}><Icon className="h-5 w-5" /></span>
            <div className="min-w-0 space-y-1">
              <AlertDialogTitle className="text-[17px] font-extrabold leading-tight">{title}</AlertDialogTitle>
              <AlertDialogDescription className="text-[13.5px] leading-snug" style={{ color: "var(--fs-mu)" }}>{body}</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <AlertDialogCancel className="fl-sbtn is-outline mt-0 w-full sm:w-auto">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction className={`fl-sbtn ${tone === "red" ? "is-failed" : "is-idle"} w-full sm:w-auto`} onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Promise-style confirm: `if (await confirm({...})) …`. Render `dialog` once in the component. */
export function useFlConfirm() {
  const [opts, setOpts] = useState<FlConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback((o: FlConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOpts(o);
  }), []);
  const settle = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setOpts(null); };
  const dialog = (
    <FlConfirmDialog
      open={opts !== null}
      onOpenChange={(o) => { if (!o) settle(false); }}
      onConfirm={() => settle(true)}
      title={opts?.title || ""}
      body={opts?.body || ""}
      confirmLabel={opts?.confirmLabel || "OK"}
      cancelLabel={opts?.cancelLabel}
      tone={opts?.tone}
      testId="fl-confirm"
    />
  );
  return { confirm, dialog };
}
