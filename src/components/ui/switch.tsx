import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Shared on/off control. A horizontal capsule, not a circle.
 * Phone CSS gives every button a 44px min-height; on a 44px-wide switch that
 * squares it into a round well with a small knob. data-no-min opts out, and
 * index.css locks 52×28 so the knob can slide from end to end.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    {...props}
    data-no-min=""
    className={cn(
      "peer inline-flex h-[28px] w-[52px] min-h-[28px] min-w-[52px] max-h-[28px] shrink-0 cursor-pointer items-center rounded-full p-[3px] transition-colors",
      "data-[state=checked]:bg-[#1F4E73] data-[state=unchecked]:bg-[#D0D5DC]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3D9BEB] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[22px] w-[22px] rounded-full bg-[#F4F5F7] shadow-[0_1px_3px_rgba(15,42,68,0.35)] ring-0 transition-transform",
        "data-[state=checked]:translate-x-[24px] data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
