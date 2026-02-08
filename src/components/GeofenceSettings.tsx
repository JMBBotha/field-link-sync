import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useBroadcastSettings } from "@/hooks/useBroadcastSettings";
import { Loader2, MapPin, Radio, Save } from "lucide-react";

const GeofenceSettings = () => {
  const { settings, loading, updateSettings } = useBroadcastSettings();
  const [localSettings, setLocalSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useState(() => {
    setLocalSettings(settings);
  });

  const handleSave = async () => {
    setSaving(true);
    const success = await updateSettings(localSettings);
    setSaving(false);
    if (success) {
      toast({ title: "Settings Saved ✅", description: "Broadcast radius settings updated" });
    } else {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    }
  };

  if (loading) return <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const radiusCards = [
    { key: "sales" as const, label: "Sales / Consultation", color: "text-blue-500" },
    { key: "technical" as const, label: "Technical / Repairs", color: "text-orange-500" },
    { key: "default" as const, label: "Default / Other", color: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-3">
        {radiusCards.map((rc) => (
          <Card key={rc.key}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className={`h-4 w-4 ${rc.color}`} />{rc.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Slider
                  value={[localSettings[rc.key]]}
                  onValueChange={([v]) => setLocalSettings((p) => ({ ...p, [rc.key]: v }))}
                  min={5} max={100} step={5} className="flex-1"
                />
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={localSettings[rc.key]}
                    onChange={(e) => setLocalSettings((p) => ({ ...p, [rc.key]: parseInt(e.target.value) || 0 }))}
                    className="w-16 text-center" min={5} max={100}
                  />
                  <span className="text-sm text-muted-foreground">km</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="min-w-32">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Settings
        </Button>
      </div>
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-primary" />How Geofencing Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>When a new lead is created, the system finds available agents within the configured radius based on the lead's service type.</p>
          <p>Only agents with <strong>location tracking enabled</strong> and <strong>"Available for leads" ON</strong> will receive notifications.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default GeofenceSettings;
