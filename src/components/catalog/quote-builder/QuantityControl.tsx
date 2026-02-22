import { memo } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface QuantityControlProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Show slider alongside buttons+input */
  showSlider?: boolean;
  /** Suffix label next to the input (e.g. "m" for metres) */
  suffix?: string;
  /** Tooltip text for the slider */
  sliderTooltip?: string;
  /** Size variant */
  size?: "sm" | "md";
  className?: string;
}

const QuantityControl = memo(function QuantityControl({
  value,
  onChange,
  min = 1,
  max = 50,
  step = 1,
  showSlider = true,
  suffix,
  sliderTooltip,
  size = "sm",
  className = "",
}: QuantityControlProps) {
  const btnSize = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const inputSize = size === "sm" ? "h-7 w-14 text-xs" : "h-8 w-16 text-sm";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className={btnSize}
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          aria-label="Decrease"
        >
          <Minus className={iconSize} />
        </Button>
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (!isNaN(parsed)) onChange(Math.max(min, Math.min(max, parsed)));
          }}
          className={`${inputSize} text-center`}
        />
        <Button
          variant="outline"
          size="icon"
          className={btnSize}
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          aria-label="Increase"
        >
          <Plus className={iconSize} />
        </Button>
      </div>
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      {showSlider && (
        sliderTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex-1 min-w-[60px]">
                <Slider
                  value={[value]}
                  onValueChange={([v]) => onChange(v)}
                  min={min}
                  max={max}
                  step={step}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {sliderTooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Slider
            value={[value]}
            onValueChange={([v]) => onChange(v)}
            min={min}
            max={max}
            step={step}
            className="flex-1 min-w-[60px]"
          />
        )
      )}
    </div>
  );
});

export default QuantityControl;
