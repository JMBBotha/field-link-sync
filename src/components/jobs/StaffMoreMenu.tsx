import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type MoreMenuItem = { label: string; testId?: string; onSelect: () => void; hidden?: boolean };

/** Radix menu, portaled, so it sits above the notes instead of being clipped by the card. */
export default function StaffMoreMenu({ testId, label = "⋯ More", items, open, onOpenChange, triggerClassName, align = "start" }: {
  testId: string;
  label?: string;
  items: MoreMenuItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
  align?: "start" | "end";
}) {
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClassName || "fl-btn-text inline-flex cursor-pointer items-center px-3"} data-testid={testId}>
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side="bottom" className="z-50 w-56 rounded-xl p-1">
        {visible.map((item) => (
          <DropdownMenuItem
            key={item.label}
            className="min-h-11 cursor-pointer rounded-lg px-3 text-[14px]"
            data-testid={item.testId}
            onSelect={() => item.onSelect()}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
