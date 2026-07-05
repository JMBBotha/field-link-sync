import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun; hint: string }[] = [
  { value: "light",  label: "Light",  icon: Sun,     hint: "Bright, high-contrast surfaces" },
  { value: "dark",   label: "Dark",   icon: Moon,    hint: "Easier on the eyes at night" },
  { value: "system", label: "System", icon: Monitor, hint: "Match your device setting" },
];

const AppearanceTab = () => {
  const { theme, setTheme, resolvedTheme } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Choose how the app looks. The <strong>System</strong> option follows your
          device's light/dark preference automatically.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {OPTIONS.map(({ value, label, icon: Icon, hint }) => {
            const active = theme === value;
            return (
              <Button
                key={value}
                type="button"
                variant="outline"
                onClick={() => setTheme(value)}
                className={cn(
                  "h-auto flex-col items-start gap-1 p-4 text-left whitespace-normal",
                  active && "border-primary ring-2 ring-primary/40",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Icon className="h-4 w-4" /> {label}
                </span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Currently active: <strong className="capitalize">{resolvedTheme}</strong>
          {theme === "system" && " (from system)"}
        </p>
      </CardContent>
    </Card>
  );
};

export default AppearanceTab;
