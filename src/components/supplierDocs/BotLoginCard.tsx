import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { sb } from "./api";

/** Admin-only: one-click disable/enable for bot logins (e.g. WALDA). Server blocks + auth ban via admin_set_bot_disabled. */
export default function BotLoginCard() {
  const { data: bots = [], refetch } = useQuery({
    queryKey: ["admin-bot-accounts"],
    queryFn: async () => ((await sb.rpc("admin_bot_accounts")).data ?? []) as any[],
  });
  if (!bots.length) return null;
  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="bot-login-card">
      {bots.map((b: any) => (
        <div key={b.user_id} className="flex items-center justify-between gap-2 text-sm">
          <div>
            <div className="font-medium">{b.display_name} login</div>
            <div className="text-xs text-muted-foreground">{b.disabled ? "Disabled" : "Active"} · read-only, can add documents and suggest links</div>
          </div>
          <Switch checked={!b.disabled} data-testid="bot-login-toggle" onCheckedChange={async (on) => {
            const { error } = await sb.rpc("admin_set_bot_disabled", { p_user_id: b.user_id, p_disabled: !on });
            if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
            refetch();
          }} />
        </div>
      ))}
    </div>
  );
}
