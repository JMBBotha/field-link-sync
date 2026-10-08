import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Empty or "Area" / "Area 3" style placeholder names. */
export function isDefaultAreaName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return n === "" || /^Area( \d+)?$/i.test(n);
}

interface Props {
  /** Saved name — printed exactly as-is. */
  name: string;
  /** Called with the trimmed new name only when it's non-empty and changed. */
  onRename: (name: string) => void;
  /** Open the input immediately (e.g. a freshly added area). */
  autoEdit?: boolean;
  className?: string;
  /** Override default-name detection (e.g. a synthetic "Add items" area). */
  isDefault?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

export function AreaNameLabel({ name, onRename, autoEdit, className = "", isDefault, onEditingChange }: Props) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const showDefault = isDefault ?? isDefaultAreaName(name);

  useEffect(() => {
    if (autoEdit) { setDraft(showDefault ? "" : name); setEditing(true); onEditingChange?.(true); }
  }, [autoEdit]);

  const open = () => {
    cancelled.current = false;
    setDraft(showDefault ? "" : name);
    setEditing(true);
    onEditingChange?.(true);
  };
  const commit = () => {
    if (cancelled.current) return;
    const v = draft.trim();
    setEditing(false);
    if (v && v !== name) onRename(v);
  };

  return (
    <div className={`min-w-0 flex-1 ${className}`}>
      {/* Print / PDF always shows the saved name. */}
      <span className="hidden print:inline">{isDefault === true ? "" : name}</span>
      {editing ? (
        <input
          autoFocus
          data-solid
          value={draft}
          aria-label="Area name"
          placeholder="Name this area (e.g. Lounge, Main bedroom)"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelled.current = true;
              setEditing(false);
            }
          }}
          className="option1-name-input w-full rounded border border-input bg-transparent px-1.5 py-0.5 text-xl font-bold normal-case print:hidden"
          data-html2canvas-ignore
        />
      ) : (
        <Button
          variant="ghost"
          data-solid
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          aria-label={showDefault ? "Name this area" : `Rename area ${name}`}
          className="option1-title h-auto max-w-full justify-start whitespace-normal p-0 text-left text-xl font-bold print:hidden"
          data-html2canvas-ignore
        >
          <span className="flex max-w-full items-center gap-1.5">
            {showDefault ? (
              <span className="font-medium normal-case text-muted-foreground">
                Name this area
              </span>
            ) : (
              <span className="break-words">{name}</span>
            )}
            <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </span>
        </Button>
      )}
    </div>
  );
}
