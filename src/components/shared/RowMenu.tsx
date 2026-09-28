import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type RowMenuItem = { label: string; onSelect: () => void; hidden?: boolean; disabled?: boolean; separatorBefore?: boolean; destructive?: boolean };

/** '⋯' quick actions for a clickable row. Never lets the click reach the row. */
const RowMenu = ({ items, label = "Actions" }: { items: RowMenuItem[]; label?: string }) => {
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div onClick={stop} onKeyDown={stop} onPointerDown={stop} onDragStart={(e) => e.preventDefault()} className="inline-flex">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={label}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stop}>
          {visible.map((i) => (
            <div key={i.label}>
              {i.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem disabled={i.disabled} className={i.destructive ? "text-destructive" : undefined}
                onSelect={() => i.onSelect()}>
                {i.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default RowMenu;
