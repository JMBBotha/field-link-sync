import { Clock, CircleDot, CircleOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AvailabilityStatus } from "@/hooks/useAvailability";

interface AvailabilityIndicatorProps {
  status: AvailabilityStatus;
  isInBufferWindow: boolean;
  nextAvailableText: string;
  compact?: boolean;
}

const AvailabilityIndicator = ({
  status,
  isInBufferWindow,
  nextAvailableText,
  compact = false,
}: AvailabilityIndicatorProps) => {
  const getStatusConfig = () => {
    if (status === "available") {
      return {
        color: "bg-green-500",
        textColor: "text-green-600",
        bgColor: "bg-green-500/10",
        borderColor: "border-green-500/30",
        label: "Available",
        icon: CircleDot,
        pulse: true,
      };
    }
    
    if (isInBufferWindow) {
      return {
        color: "bg-orange-500",
        textColor: "text-orange-600",
        bgColor: "bg-orange-500/10",
        borderColor: "border-orange-500/30",
        label: "Buffer",
        icon: Clock,
        pulse: true,
      };
    }
    
    if (status === "busy") {
      return {
        color: "bg-yellow-500",
        textColor: "text-yellow-600",
        bgColor: "bg-yellow-500/10",
        borderColor: "border-yellow-500/30",
        label: "Busy",
        icon: Clock,
        pulse: false,
      };
    }
    
    return {
      color: "bg-gray-500",
      textColor: "text-gray-600",
      bgColor: "bg-gray-500/10",
      borderColor: "border-gray-500/30",
      label: "Offline",
      icon: CircleOff,
      pulse: false,
    };
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            <div className={`relative h-2.5 w-2.5 rounded-full ${config.color}`}>
              {config.pulse && (
                <span className={`absolute inset-0 rounded-full ${config.color} animate-ping opacity-75`} />
              )}
            </div>
            <span className={`text-xs font-medium ${config.textColor}`}>
              {config.label}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{nextAvailableText}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bgColor} border ${config.borderColor}`}>
      <div className="relative">
        <div className={`h-2 w-2 rounded-full ${config.color}`}>
          {config.pulse && (
            <span className={`absolute inset-0 rounded-full ${config.color} animate-ping opacity-75`} />
          )}
        </div>
      </div>
      <span className={`text-xs font-medium ${config.textColor}`}>
        {status === "available" ? "Available now" : nextAvailableText}
      </span>
    </div>
  );
};

export default AvailabilityIndicator;
