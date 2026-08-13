import { useEffect, useState, useRef } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BaseProps {
  label: string;
  value: any;
  saving?: boolean;
  disabled?: boolean;
  onSave: (value: any) => Promise<any> | void;
  className?: string;
}

const Shell = ({
  label,
  saving,
  children,
  className,
}: {
  label: string;
  saving?: boolean;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("min-w-0", className)}>
    <p className="text-muted-foreground text-xs flex items-center gap-1">
      {label}
      {saving && <Loader2 className="h-3 w-3 animate-spin" />}
    </p>
    {children}
  </div>
);

const displayValue = (v: any) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

/** Click-to-edit text / email / tel / date / time / datetime field. */
export const EditableField = ({
  label,
  value,
  saving,
  disabled,
  onSave,
  type = "text",
  placeholder,
  className,
  format,
}: BaseProps & {
  type?: string;
  placeholder?: string;
  format?: (v: any) => string;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    const next = draft === "" ? null : draft;
    setEditing(false);
    if (next === (value ?? null)) return;
    await onSave(next);
  };

  if (editing) {
    return (
      <Shell label={label} saving={saving} className={className}>
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            type={type}
            value={draft ?? ""}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(value ?? "");
                setEditing(false);
              }
            }}
            className="h-8 text-sm"
          />
          <button
            type="button"
            aria-label="Save"
            onClick={commit}
            className="p-1 rounded hover:bg-muted"
          >
            <Check className="h-4 w-4 text-primary" />
          </button>
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => {
              setDraft(value ?? "");
              setEditing(false);
            }}
            className="p-1 rounded hover:bg-muted"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell label={label} saving={saving} className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="group flex w-full items-center gap-1 rounded px-1 -mx-1 py-0.5 text-left font-medium text-sm hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="truncate">{format ? format(value) : displayValue(value)}</span>
        {!disabled && (
          <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
        )}
      </button>
    </Shell>
  );
};

/** Inline dropdown that saves immediately on change. */
export const EditableSelect = ({
  label,
  value,
  saving,
  disabled,
  onSave,
  options,
  placeholder = "Not set",
  className,
  renderValue,
}: BaseProps & {
  options: { value: string; label: string }[];
  placeholder?: string;
  renderValue?: (v: any) => React.ReactNode;
}) => (
  <Shell label={label} saving={saving} className={className}>
    <Select
      value={value ?? ""}
      disabled={disabled}
      onValueChange={(v) => onSave(v === "__none__" ? null : v)}
    >
      <SelectTrigger className="h-8 text-sm border-transparent bg-transparent px-1 -mx-1 hover:bg-muted/60 focus:border-input">
        <SelectValue placeholder={placeholder}>
          {renderValue
            ? renderValue(value)
            : options.find((o) => o.value === value)?.label ??
              (value ? String(value).replace(/_/g, " ") : placeholder)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="z-[60]">
        <SelectItem value="__none__">{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="capitalize">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </Shell>
);

/** Date + time pair that saves as a single ISO timestamp. */
export const EditableDateTime = ({
  label,
  value,
  saving,
  disabled,
  onSave,
  className,
}: BaseProps) => {
  const iso = value ? new Date(value) : null;
  const dateStr = iso ? iso.toISOString().slice(0, 10) : "";
  const timeStr = iso
    ? `${String(iso.getHours()).padStart(2, "0")}:${String(iso.getMinutes()).padStart(2, "0")}`
    : "";

  const save = (d: string, t: string) => {
    if (!d) return onSave(null);
    const merged = new Date(`${d}T${t || "08:00"}:00`);
    return onSave(merged.toISOString());
  };

  return (
    <Shell label={label} saving={saving} className={className}>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={dateStr}
          disabled={disabled}
          onChange={(e) => save(e.target.value, timeStr)}
          className="h-8 text-sm"
        />
        <Input
          type="time"
          value={timeStr}
          disabled={disabled || !dateStr}
          onChange={(e) => save(dateStr, e.target.value)}
          className="h-8 w-28 text-sm"
        />
      </div>
    </Shell>
  );
};

/** Multi-line notes with explicit save on blur. */
export const EditableNotes = ({
  label,
  value,
  saving,
  disabled,
  onSave,
  placeholder = "Add notes…",
  className,
}: BaseProps & { placeholder?: string }) => {
  const [draft, setDraft] = useState(value ?? "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value ?? "");
  }, [value, focused]);

  return (
    <Shell label={label} saving={saving} className={className}>
      <Textarea
        rows={3}
        value={draft ?? ""}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          setFocused(false);
          const next = draft === "" ? null : draft;
          if (next !== (value ?? null)) await onSave(next);
        }}
        className="text-sm resize-none"
      />
    </Shell>
  );
};
