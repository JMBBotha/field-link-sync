import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus } from "lucide-react";

export const AREA_NAME_PICKS = ["Main bedroom", "Bedroom", "Guest bedroom", "Bedroom 1", "Lounge", "Kitchen", "Office", "Dining room", "Study", "Other (type own)"];
export const PRIMARY_AREA_PICKS = ["Main bedroom", "Guest bedroom", "Lounge", "Office"];
export const OTHER_AREA_PICKS = ["Bedroom", "Bedroom 1", "Kitchen", "Dining room", "Study"];

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

function CanonicalAreaChoices({ existingNames, onCreate }: {
  existingNames: string[];
  onCreate: (name: string) => void | Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const create = async (name: string) => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(nextAreaName(name, existingNames));
      setCustom("");
      setShowCustom(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3" data-testid="canonical-area-choices">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PRIMARY_AREA_PICKS.map((name) => (
          <Button key={name} type="button" disabled={busy} onClick={() => void create(name)} className="min-h-11 whitespace-normal bg-primary text-primary-foreground hover:bg-primary/90">
            {name}
          </Button>
        ))}
        <DropdownMenu onOpenChange={(open) => { if (!open) setShowCustom(false); }}>
          <DropdownMenuTrigger asChild>
            <Button type="button" disabled={busy} variant="outline" className="min-h-11 gap-1 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10">
              Other <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {OTHER_AREA_PICKS.map((name) => <DropdownMenuItem key={name} onSelect={() => void create(name)}>{name}</DropdownMenuItem>)}
            <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setShowCustom(true); setTimeout(() => input.current?.focus(), 0); }}>Type own name</DropdownMenuItem>
            {showCustom && (
              <form className="flex gap-2 p-2" onSubmit={(event) => { event.preventDefault(); void create(custom); }}>
                <Input ref={input} aria-label="New area name" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Area name" className="h-9 min-w-0" />
                <Button type="submit" size="sm" disabled={!custom.trim() || busy}>Add</Button>
              </form>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Canonical quote flow: full chooser for the first area, then the same chooser in an Add area dialog. */
export function CanonicalAreaCreateControl({ existingNames, onCreate }: {
  existingNames: string[];
  onCreate: (name: string) => void | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const create = async (name: string) => {
    await onCreate(name);
    setOpen(false);
  };
  if (existingNames.length === 0) {
    return <CanonicalAreaChoices existingNames={existingNames} onCreate={onCreate} />;
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11 w-full justify-center gap-2 border-primary/30 text-primary" data-testid="canonical-add-area">
          <Plus className="h-4 w-4" /> Add area
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl border-border bg-card shadow-xl">
        <DialogHeader><DialogTitle>Create area</DialogTitle></DialogHeader>
        <CanonicalAreaChoices existingNames={existingNames} onCreate={create} />
      </DialogContent>
    </Dialog>
  );
}