import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

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
}

export function AreaNameLabel({ name, onRename, autoEdit, className = "", isDefault }: Props) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const showDefault = isDefault ?? isDefaultAreaName(name);

  useEffect(() => {
    if (autoEdit) setEditing(true);
  }, [autoEdit]);

  const open = () => {
    cancelled.current = false;
    setDraft(showDefault ? "" : name);
    setEditing(true);
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
      <span className="hidden print:inline">{name}</span>
      {editing ? (
        <input
          autoFocus
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
          className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-sm normal-case tracking-normal font-normal text-foreground print:hidden"
          data-html2canvas-ignore
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          aria-label={showDefault ? "Name this area" : `Rename area ${name}`}
          className="flex max-w-full flex-col items-start text-left print:hidden"
          data-html2canvas-ignore
        >
          <span className="flex max-w-full items-center gap-1.5">
            {showDefault ? (
              <span className="truncate italic font-normal normal-case tracking-normal text-muted-foreground">
                Tap to name this area
              </span>
            ) : (
              <span className="truncate">{name}</span>
            )}
            <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </span>
          {showDefault && (
            <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">e.g. Lounge</span>
          )}
        </button>
      )}
    </div>
  );
}
