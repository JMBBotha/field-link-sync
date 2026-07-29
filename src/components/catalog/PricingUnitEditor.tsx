import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  UNIT_TYPES,
  PRICING_UNIT_PRESETS,
  defaultLabel,
  formatUnitPrice,
  type PricingUnit,
  type UnitType,
} from "@/lib/pricingUnits";

interface Props {
  value: PricingUnit;
  onChange: (next: PricingUnit) => void;
  /** Optional unit price used for the live example line */
  unitPrice?: number;
  compact?: boolean;
}

/**
 * Pricing Unit section — lets a user say how an item is sold:
 * per item, per meter, per 100m, per 30m roll, per 500g, etc.
 */
const PricingUnitEditor = ({ value, onChange, unitPrice = 0, compact }: Props) => {
  const set = (patch: Partial<PricingUnit>) => onChange({ ...value, ...patch });

  const applyPreset = (id: string) => {
    const preset = PRICING_UNIT_PRESETS.find((p) => p.id === id);
    if (preset) onChange({ ...preset.value });
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pricing Unit
        </Label>
        <Badge variant="outline" className="text-[10px]">
          {formatUnitPrice(unitPrice, value)}
        </Badge>
      </div>

      <div>
        <Label className="text-xs">Sold as</Label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {PRICING_UNIT_PRESETS.map((p) => {
            const active =
              p.value.unit_type === value.unit_type &&
              p.value.price_per_unit_qty === value.price_per_unit_qty;
            return (
              <Badge
                key={p.id}
                variant={active ? "default" : "outline"}
                className="cursor-pointer text-[10px]"
                onClick={() => applyPreset(p.id)}
              >
                {p.label}
              </Badge>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">Unit type</Label>
          <Select value={value.unit_type} onValueChange={(v) => {
            const ut = v as UnitType;
            set({ unit_type: ut, price_per_unit_label: defaultLabel(ut, value.price_per_unit_qty) });
          }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNIT_TYPES.map((u) => (
                <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Price covers</Label>
          <Input
            type="number"
            min={0.0001}
            step="any"
            className="h-8 text-xs"
            value={value.price_per_unit_qty}
            onChange={(e) => {
              const qty = parseFloat(e.target.value);
              const safe = Number.isFinite(qty) && qty > 0 ? qty : 1;
              set({ price_per_unit_qty: safe, price_per_unit_label: defaultLabel(value.unit_type, safe) });
            }}
          />
        </div>
        <div>
          <Label className="text-xs">Unit label</Label>
          <Input
            className="h-8 text-xs"
            value={value.price_per_unit_label}
            onChange={(e) => set({ price_per_unit_label: e.target.value })}
            placeholder="e.g. 30m roll"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 items-end">
        <div className="col-span-1 flex items-center gap-2 pb-1">
          <Switch
            checked={value.allows_decimal_qty}
            onCheckedChange={(c) =>
              set({
                allows_decimal_qty: c,
                qty_step: c ? (value.qty_step < 1 ? value.qty_step : 0.1) : 1,
                min_qty: c ? value.min_qty : Math.max(1, Math.round(value.min_qty)),
              })
            }
          />
          <Label className="text-xs">Decimals</Label>
        </div>
        <div>
          <Label className="text-xs">Qty step</Label>
          <Input
            type="number"
            step="any"
            min={0.0001}
            className="h-8 text-xs"
            value={value.qty_step}
            onChange={(e) => set({ qty_step: Math.max(parseFloat(e.target.value) || 1, 0.0001) })}
          />
        </div>
        <div>
          <Label className="text-xs">Min qty</Label>
          <Input
            type="number"
            step="any"
            min={0}
            className="h-8 text-xs"
            value={value.min_qty}
            onChange={(e) => set({ min_qty: Math.max(parseFloat(e.target.value) || 0, 0) })}
          />
        </div>
      </div>
    </div>
  );
};

export default PricingUnitEditor;
