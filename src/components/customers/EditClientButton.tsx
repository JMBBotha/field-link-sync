import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Header control on the client page. Opens the details tab. Visible without opening the ⋯ menu. */
export function EditClientButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      type="button"
      data-testid="edit-client-details"
      onClick={onClick}
      className={cn(
        "h-10 rounded-xl bg-white px-3 font-semibold text-[#0F2A44] hover:bg-[#E8F6FE]",
        className,
      )}
    >
      <Pencil className="h-4 w-4" />
      Edit details
    </Button>
  );
}

/** One pencil per client-list row, including on a phone. Opens that client's details tab. */
export function ClientRowEditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="edit-client-row"
      aria-label={`Edit ${name}`}
      title="Edit client"
      className="h-9 shrink-0 gap-1 border-[#1590D6]/50 bg-white px-2.5 font-semibold text-[#0F2A44] hover:bg-[#E8F6FE]"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Pencil className="h-4 w-4 text-[#1590D6]" />
      Edit
    </Button>
  );
}
