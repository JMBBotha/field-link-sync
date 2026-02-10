import { LayoutDashboard, Briefcase, MapPin, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface FieldAgentBottomNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: "available", label: "Home", icon: LayoutDashboard },
  { id: "active", label: "My Jobs", icon: Briefcase },
  { id: "map", label: "Map", icon: MapPin },
  { id: "profile", label: "Profile", icon: User },
];

const FieldAgentBottomNav = ({ activeTab, onTabChange }: FieldAgentBottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 border-t border-blue-400/20 bg-gradient-to-r from-[#0a1628]/90 via-[#0f2240]/85 to-[#0a1628]/90 backdrop-blur-md md:hidden">
      <div className="flex items-center justify-around h-full px-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors relative",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              {isActive && (
                <div className="absolute top-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
              <tab.icon className="h-5 w-5 mt-1" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default FieldAgentBottomNav;
