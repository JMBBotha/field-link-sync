import { Switch } from "@/components/ui/switch";

export type BookableTechOption = { id: string; name: string; noLogin?: boolean };

/**
 * Admin control on a salesperson row. Same sliding pill as the rest of the app.
 * Turning one on or off is the only write; there is no separate save button.
 */
export function SalesTechChecklist({
  techs,
  assignedIds,
  onToggle,
  disabled = false,
}: {
  techs: BookableTechOption[];
  assignedIds: readonly string[];
  onToggle: (techId: string, on: boolean) => void;
  disabled?: boolean;
}) {
  const on = new Set(assignedIds);
  return (
    <div data-testid="techs-they-can-book">
      <h4 className="mb-2 text-sm font-semibold text-foreground">Technicians they can book</h4>
      {techs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No service-lane technicians in this company yet.</p>
      ) : (
        <ul className="space-y-2">
          {techs.map((tech) => (
            <li
              key={tech.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-background px-3 py-2"
            >
              <span className="text-sm font-medium text-foreground">
                {tech.name}
                {tech.noLogin ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">No login yet</span> : null}
              </span>
              <Switch
                checked={on.has(tech.id)}
                disabled={disabled}
                onCheckedChange={(next) => onToggle(tech.id, next)}
                aria-label={`Technicians they can book: ${tech.name}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
