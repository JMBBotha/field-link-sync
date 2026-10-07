import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const AREA_NAME_PICKS = ["Main bedroom", "Bedroom", "Guest bedroom", "Bedroom 1", "Lounge", "Kitchen", "Office", "Dining room", "Study", "Other (type own)"];

export function nextAreaName(name: string, existingNames: string[]): string {
  const base = name.trim();
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const stem = base.replace(/\s+\d+$/, "");
  let number = 2;
  while (taken.has(`${stem} ${number}`.toLowerCase())) number++;
  return `${stem} ${number}`;
}

export function AreaNameChips({ existingNames, onPick, onOther, disabled = false }: {
  existingNames: string[];
  onPick: (name: string) => void;
  onOther: () => void;
  disabled?: boolean;
}) {
  return <div className="flex flex-wrap gap-2 print:hidden" data-testid="area-name-chips" data-html2canvas-ignore>
    {AREA_NAME_PICKS.map((name) => <Button key={name} type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal text-left text-xs sm:min-h-9" disabled={disabled}
      onClick={() => name === "Other (type own)" ? onOther() : onPick(nextAreaName(name, existingNames))}>{name}</Button>)}
  </div>;
}

/** Shared input row; callers retain their existing area-add path. */
export function AreaCreateControl({ existingNames, onCreate, label = "Create area" }: {
  existingNames: string[];
  onCreate: (name: string) => void | Promise<unknown>;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async (value: string) => {
    if (!value.trim() || busy) return;
    setName(value);
    setBusy(true);
    try { await onCreate(nextAreaName(value, existingNames)); setName(""); } finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void create(name); }}>
      <Input ref={input} aria-label="New area name" placeholder="Name this area (e.g. Lounge, Main bedroom)" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 h-11" />
      <Button type="submit" variant="outline" disabled={busy || !name.trim()} className="h-11 shrink-0">{label}</Button>
    </form>
    <AreaNameChips existingNames={existingNames} disabled={busy} onPick={(value) => void create(value)} onOther={() => input.current?.focus()} />
  </div>;
}