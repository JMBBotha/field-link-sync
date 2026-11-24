import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { PreviewChoice } from "@/lib/documentPreviewChoices";

/**
 * Small light choice opened from a document preview.
 * Orange is the one main action. The sky bar matches the V8 bars.
 */
export default function DocumentChoiceDialog({
  open,
  onOpenChange,
  title,
  choices,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  choices: PreviewChoice[];
  onSelect: (id: string) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/25 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid="document-choice"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-[#DCE7F0] bg-white text-[#0F1B2A] shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <div className="h-1.5 bg-[#3D9BEB]" aria-hidden />
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3 pr-6">
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            </div>
            <div className="flex flex-col gap-2">
              {choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  data-testid={`document-choice-${choice.id}`}
                  autoFocus={!!choice.primary}
                  className={
                    choice.primary
                      ? "inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#C2410C] px-4 text-sm font-semibold text-white hover:bg-[#9A3412] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2"
                      : "inline-flex h-11 w-full items-center justify-center rounded-lg border border-[#DCE7F0] bg-white px-4 text-sm font-semibold text-[#0F1B2A] hover:bg-[#F4F8FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3D9BEB] focus-visible:ring-offset-2"
                  }
                  onClick={() => onSelect(choice.id)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
          <DialogPrimitive.Close className="absolute right-3 top-4 rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3D9BEB]" aria-label="Close">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
