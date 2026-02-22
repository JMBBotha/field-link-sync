import { memo } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hapticTap } from "@/lib/haptics";
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
  /** Show the current value as a label after the slider */
  showValueLabel?: boolean;
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
  showValueLabel = false,
  className = "",
}: QuantityControlProps) {
  const btnSize = size === "sm" ? "h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-6 sm:w-6" : "h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7";
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const inputWidth = size === "sm" ? "w-14" : "w-20";
  const inputHeight = size === "sm" ? "h-9 text-xs min-h-[44px] sm:min-h-0 sm:h-7" : "h-10 text-sm min-h-[44px] sm:min-h-0 sm:h-8";

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* -/+ buttons with number input */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className={btnSize}
          onClick={() => { onChange(clamp(value - step)); hapticTap("light"); }}
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
            if (!isNaN(parsed)) onChange(clamp(parsed));
          }}
          className={`${inputWidth} ${inputHeight} text-right`}
        />
        <Button
          variant="outline"
          size="icon"
          className={btnSize}
          onClick={() => { onChange(clamp(value + step)); hapticTap("light"); }}
          disabled={value >= max}
          aria-label="Increase"
        >
          <Plus className={iconSize} />
        </Button>
      </div>

      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}

      {/* Slider */}
      {showSlider && (
        sliderTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex-1 min-w-[100px]">
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
            className="flex-1 min-w-[100px]"
          />
        )
      )}

      {/* Value label */}
      {showValueLabel && (
        <span className="text-sm font-medium min-w-[50px] text-right tabular-nums">
          {value}{suffix ? ` ${suffix}` : ""}
        </span>
      )}
    </div>
  );
});

export default QuantityControl;
