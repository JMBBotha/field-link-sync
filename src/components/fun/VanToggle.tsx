import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { isVanDriveByEnabled, setVanDriveByEnabled } from "./VanDriveBy";

export default function VanToggle() {
  const [on, setOn] = useState(isVanDriveByEnabled());
  return (
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-sm font-semibold">Van drive-by</p><p className="text-xs text-muted-foreground">Our van drives along the bottom of the screen once per session. Saved on this device.</p></div>
      <Switch checked={on} onCheckedChange={(v) => { setOn(v); setVanDriveByEnabled(v); }} aria-label="Van drive-by" />
    </div>
  );
}
