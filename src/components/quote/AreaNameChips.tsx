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

export function CanonicalAreaChoices({ existingNames, onCreate }: {
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
    <div className="space-y-3 print:hidden" data-html2canvas-ignore data-testid="canonical-area-choices">
      <div className="flex flex-wrap gap-2">
        {PRIMARY_AREA_PICKS.map((name) => (
          <Button key={name} type="button" variant="outline" data-solid disabled={busy} onClick={() => void create(name)} className="option1-name-chip h-10 whitespace-normal rounded-md px-4 font-medium">
            {name}
          </Button>
        ))}
        <DropdownMenu onOpenChange={(open) => { if (!open) setShowCustom(false); }}>
          <DropdownMenuTrigger asChild>
            <Button type="button" data-solid disabled={busy} variant="outline" className="option1-other-chip h-10 rounded-md border-dashed px-4">
              Other…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {OTHER_AREA_PICKS.map((name) => <DropdownMenuItem key={name} onSelect={() => void create(name)}>{name}</DropdownMenuItem>)}
            <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setShowCustom(true); setTimeout(() => input.current?.focus(), 0); }}>Type own name</DropdownMenuItem>
            {showCustom && (
              <form className="flex gap-2 p-2" onSubmit={(event) => { event.preventDefault(); void create(custom); }}>
                <Input ref={input} data-solid aria-label="New area name" value={custom} maxLength={60} onChange={(event) => setCustom(event.target.value)} placeholder="Area name" className="h-9 min-w-0" />
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
        <Button type="button" variant="outline" data-solid data-no-min className="option1-create-area h-9 w-auto self-start justify-start gap-1.5 rounded-lg px-4 text-sm font-semibold shadow-sm" data-testid="canonical-add-area">
          <Plus className="h-4 w-4" /> Add Area
        </Button>
      </DialogTrigger>
      <DialogContent data-solid data-paper className="option1-solid max-w-2xl shadow-xl">
        <DialogHeader><DialogTitle>Add area</DialogTitle></DialogHeader>
        <CanonicalAreaChoices existingNames={existingNames} onCreate={create} />
      </DialogContent>
    </Dialog>
  );
}