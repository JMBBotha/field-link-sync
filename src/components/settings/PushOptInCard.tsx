import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { pushSupport, currentPushSubscription, enablePush, disablePush, type PushSupport } from "@/lib/webPush";

export function PushOptInView({ support, on, busy, onToggle }: { support: PushSupport; on: boolean; busy?: boolean; onToggle: (v: boolean) => void }) {
  return (
    <Card className="mt-4" data-testid="push-optin">
      <CardHeader><CardTitle className="text-base">Phone alerts (push)</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Off unless you switch it on. When on, this device shows a pop-up for new sale offers, requests that need attention
          and the 10-minute unclaimed alert. Pop-ups show only what your bell shows; offers show the job type and rough area, never client details before you accept.
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Send alerts to this device</span>
          <Switch data-testid="push-toggle" checked={on} disabled={busy || support !== "supported"} onCheckedChange={onToggle} aria-label="Send alerts to this device" />
        </div>
        {support === "ios-home-screen" && <p className="rounded-md bg-muted p-2" data-testid="push-ios">On iPhone, add Field Link to your home screen first (Share → Add to Home Screen, iOS 16.4 or later), then open it from there and switch this on.</p>}
        {support === "unsupported" && <p className="rounded-md bg-muted p-2">This browser can't show push alerts. Your bell still works.</p>}
        {support === "no-key" && <p className="rounded-md bg-muted p-2">Phone alerts are not set up yet.</p>}
        <p className="text-xs text-muted-foreground">
          We store only this device's push address, linked to your account, to deliver these alerts (POPIA). Switch off any time
          here, or block notifications in your phone settings; switching off deletes this device's push address.
        </p>
      </CardContent>
    </Card>
  );
}

export default function PushOptInCard() {
  const [support] = useState<PushSupport>(() => pushSupport());
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (support === "supported") currentPushSubscription().then((s) => setOn(!!s)).catch(() => {}); }, [support]);
  const onToggle = async (v: boolean) => {
    setBusy(true);
    try {
      if (v) { const ok = await enablePush(); setOn(ok); if (!ok) toast.message("Notifications are blocked for this site in your browser settings."); }
      else { await disablePush(); setOn(false); toast.success("Phone alerts off for this device"); }
    } catch { toast.error("Couldn't change phone alerts"); } finally { setBusy(false); }
  };
  return <PushOptInView support={support} on={on} busy={busy} onToggle={onToggle} />;
}
