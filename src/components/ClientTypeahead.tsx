import { User } from "lucide-react";
import type { UnifiedClient } from "@/hooks/useUnifiedClients";

interface ClientTypeaheadProps {
  /** Current text in the name field. Empty/whitespace => render nothing. */
  query: string;
  /** Whether the name field is focused. False => render nothing. */
  open: boolean;
  clients: UnifiedClient[];
  onSelect: (client: UnifiedClient) => void;
}

/**
 * Type-ahead list of existing clients shown under the customer name field.
 * Renders nothing until the field is focused AND the user has typed at
 * least one character, so the new-lead form is immediately usable with no
 * client list in the way.
 */
const ClientTypeahead = ({ query, open, clients, onSelect }: ClientTypeaheadProps) => {
  const q = query.trim().toLowerCase();
  if (!open || !q) return null;

  const matches = clients
    .filter((c) => c.customer_id) // only real customers are linkable
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q))
    )
    .slice(0, 8);

  if (matches.length === 0) return null; // no match: user just keeps typing a new client

  return (
    <div
      data-testid="client-typeahead"
      className="absolute z-50 top-full mt-1 w-full rounded-lg border bg-popover shadow-xl max-h-56 overflow-y-auto"
    >
      {matches.map((c) => (
        <button
          key={c.customer_id}
          type="button"
          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent text-left"
          onPointerDown={(e) => {
            e.preventDefault();
            onSelect(c);
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(c);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            onSelect(c);
          }}
        >
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{c.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {c.phone}
              {c.address ? ` · ${c.address}` : ""}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
};

export default ClientTypeahead;
