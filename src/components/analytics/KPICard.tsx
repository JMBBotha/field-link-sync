import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface KPICardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  delta?: number;
  icon: LucideIcon;
  gradient: string;
  decimals?: number;
}

const KPICard = ({ label, value, prefix = "", suffix = "", delta, icon: Icon, gradient, decimals = 0 }: KPICardProps) => {
  const [displayValue, setDisplayValue] = useState(0);
  const animationRef = useRef<number>();

  useEffect(() => {
    const duration = 1200;
    const startTime = performance.now();
    const startVal = 0;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(startVal + (value - startVal) * eased);
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [value]);

  const formattedValue = decimals > 0
    ? displayValue.toFixed(decimals)
    : Math.round(displayValue).toLocaleString("en-ZA");

  return (
    <Card
      className="relative overflow-hidden rounded-2xl border-0 shadow-xl p-6 text-white"
      style={{ background: gradient }}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-white/80">{label}</p>
          <p className="text-3xl font-bold tracking-tight">
            {prefix}{formattedValue}{suffix}
          </p>
          {delta !== undefined && (
            <p className={`text-sm font-medium ${delta >= 0 ? "text-emerald-200" : "text-red-200"}`}>
              {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}% vs last month
            </p>
          )}
        </div>
        <div className="rounded-xl bg-white/20 p-3">
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </Card>
  );
};

export default KPICard;
