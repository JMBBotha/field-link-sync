import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useBroadcastSettings } from "@/hooks/useBroadcastSettings";
import { Loader2, MapPin, Settings as SettingsIcon, Radio, Save } from "lucide-react";

const AdminSettings = () => {
  const { settings, loading, updateSettings } = useBroadcastSettings();
  const [localSettings, setLocalSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Sync local state when settings load
  useState(() => {
    setLocalSettings(settings);
  });

  const handleSave = async () => {
    setSaving(true);
    const success = await updateSettings(localSettings);
    setSaving(false);

    if (success) {
      toast({
        title: "Settings Saved ✅",
        description: "Broadcast radius settings have been updated",
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to save settings",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">Geofence Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure broadcast radius for lead notifications
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-blue-500" />
              Sales / Consultation
            </CardTitle>
            <CardDescription>
              Radius for sales leads and consultations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Slider
                value={[localSettings.sales]}
                onValueChange={([value]) =>
                  setLocalSettings((prev) => ({ ...prev, sales: value }))
                }
                min={5}
                max={100}
                step={5}
                className="flex-1"
              />
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={localSettings.sales}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      sales: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-16 text-center"
                  min={5}
                  max={100}
                />
                <span className="text-sm text-muted-foreground">km</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Agents within {localSettings.sales}km will receive sales lead notifications
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-orange-500" />
              Technical / Repairs
            </CardTitle>
            <CardDescription>
              Radius for repair and installation leads
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Slider
                value={[localSettings.technical]}
                onValueChange={([value]) =>
                  setLocalSettings((prev) => ({ ...prev, technical: value }))
                }
                min={5}
                max={100}
                step={5}
                className="flex-1"
              />
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={localSettings.technical}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      technical: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-16 text-center"
                  min={5}
                  max={100}
                />
                <span className="text-sm text-muted-foreground">km</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Agents within {localSettings.technical}km will receive technical lead notifications
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-gray-500" />
              Default / Other
            </CardTitle>
            <CardDescription>
              Fallback radius for other lead types
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Slider
                value={[localSettings.default]}
                onValueChange={([value]) =>
                  setLocalSettings((prev) => ({ ...prev, default: value }))
                }
                min={5}
                max={100}
                step={5}
                className="flex-1"
              />
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={localSettings.default}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      default: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-16 text-center"
                  min={5}
                  max={100}
                />
                <span className="text-sm text-muted-foreground">km</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Agents within {localSettings.default}km will receive other lead notifications
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="min-w-32">
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Settings
        </Button>
      </div>

      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-primary" />
            How Geofencing Works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            When a new lead is created, the system automatically finds all available agents
            within the configured broadcast radius based on the lead's service type.
          </p>
          <p>
            Only agents with <strong>location tracking enabled</strong> and{" "}
            <strong>"Available for leads" turned ON</strong> will receive notifications.
          </p>
          <p>
            Leads are sorted by priority first, then by proximity to the agent's current
            location or home base for scheduled jobs.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSettings;
