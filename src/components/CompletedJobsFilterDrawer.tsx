import { useState, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { format, subDays, startOfMonth } from "date-fns";
import { CalendarIcon, Search, MapPin, Users, X, Filter, Loader2 } from "lucide-react";
import type { CompletedJobsFilters } from "@/hooks/useCompletedJobsFilter";

interface Agent {
  id: string;
  full_name: string;
}

interface CompletedJobsFilterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: CompletedJobsFilters;
  onApply: (filters: CompletedJobsFilters) => void;
  onClear: () => void;
  currentLocation?: { lat: number; lng: number } | null;
  loading?: boolean;
  isAdmin?: boolean;
}

type DatePreset = "7d" | "30d" | "90d" | "month" | "custom" | null;

const CompletedJobsFilterDrawer = ({
  open,
  onOpenChange,
  filters,
  onApply,
  onClear,
  currentLocation,
  loading,
  isAdmin,
}: CompletedJobsFilterDrawerProps) => {
  const [agentMode, setAgentMode] = useState<"all" | "specific">("all");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>(null);
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [useLocation, setUseLocation] = useState(false);
  const [radiusKm, setRadiusKm] = useState(25);
  const [search, setSearch] = useState("");

  // Sync from external filters on open
  useEffect(() => {
    if (open) {
      setSearch(filters.search || "");
      setStartDate(filters.startDate ? new Date(filters.startDate) : undefined);
      setEndDate(filters.endDate ? new Date(filters.endDate) : undefined);
      setSelectedAgentIds(filters.agentIds || []);
      setAgentMode(filters.agentIds?.length ? "specific" : "all");
      setUseLocation(filters.centerLat !== null);
      setRadiusKm(filters.radiusKm || 25);
    }
  }, [open, filters]);

  // Fetch agents list for admin
  useEffect(() => {
    if (!isAdmin || !open) return;
    const fetchAgents = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name");
      if (data) setAgents(data);
    };
    fetchAgents();
  }, [isAdmin, open]);

  const applyDatePreset = useCallback((preset: DatePreset) => {
    setDatePreset(preset);
    const now = new Date();
    switch (preset) {
      case "7d":
        setStartDate(subDays(now, 7));
        setEndDate(now);
        break;
      case "30d":
        setStartDate(subDays(now, 30));
        setEndDate(now);
        break;
      case "90d":
        setStartDate(subDays(now, 90));
        setEndDate(now);
        break;
      case "month":
        setStartDate(startOfMonth(now));
        setEndDate(now);
        break;
      case "custom":
        break;
      default:
        setStartDate(undefined);
        setEndDate(undefined);
    }
  }, []);

  const handleApply = () => {
    const newFilters: CompletedJobsFilters = {
      agentIds: agentMode === "specific" && selectedAgentIds.length > 0 ? selectedAgentIds : null,
      startDate: startDate?.toISOString() || null,
      endDate: endDate?.toISOString() || null,
      centerLat: useLocation && currentLocation ? currentLocation.lat : null,
      centerLng: useLocation && currentLocation ? currentLocation.lng : null,
      radiusKm: useLocation ? radiusKm : null,
      search: search.trim() || null,
    };
    onApply(newFilters);
    onOpenChange(false);
  };

  const handleClear = () => {
    setAgentMode("all");
    setSelectedAgentIds([]);
    setDatePreset(null);
    setStartDate(undefined);
    setEndDate(undefined);
    setUseLocation(false);
    setRadiusKm(25);
    setSearch("");
    onClear();
    onOpenChange(false);
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] p-0" hideCloseButton>
        <div className="flex flex-col h-full max-h-[85vh]">
          {/* Header */}
          <SheetHeader className="px-4 pt-4 pb-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Filter className="h-4 w-4" />
                Filter Completed Jobs
              </SheetTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </SheetHeader>

          {/* Scrollable filters */}
          <ScrollArea className="flex-1 px-4">
            <div className="space-y-5 pb-4">
              {/* Search */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5" />
                  Search
                </Label>
                <Input
                  placeholder="Service type or customer name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9"
                />
              </div>

              {/* Agent Filter (Admin Only) */}
              {isAdmin && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    Agents
                  </Label>
                  <RadioGroup
                    value={agentMode}
                    onValueChange={(v) => {
                      setAgentMode(v as "all" | "specific");
                      if (v === "all") setSelectedAgentIds([]);
                    }}
                    className="flex gap-4"
                  >
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="all" id="all-agents" />
                      <Label htmlFor="all-agents" className="text-sm">All Agents</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="specific" id="specific-agents" />
                      <Label htmlFor="specific-agents" className="text-sm">Specific</Label>
                    </div>
                  </RadioGroup>
                  {agentMode === "specific" && (
                    <div className="max-h-32 overflow-y-auto space-y-1.5 border rounded-md p-2">
                      {agents.map((agent) => (
                        <div key={agent.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`agent-${agent.id}`}
                            checked={selectedAgentIds.includes(agent.id)}
                            onCheckedChange={() => toggleAgent(agent.id)}
                          />
                          <Label htmlFor={`agent-${agent.id}`} className="text-sm cursor-pointer">
                            {agent.full_name}
                          </Label>
                        </div>
                      ))}
                      {agents.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">No agents found</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Date Range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Date Range
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { value: "7d", label: "Last 7d" },
                    { value: "30d", label: "Last 30d" },
                    { value: "90d", label: "Last 90d" },
                    { value: "month", label: "This Month" },
                    { value: "custom", label: "Custom" },
                  ] as { value: DatePreset; label: string }[]).map((preset) => (
                    <Badge
                      key={preset.value}
                      variant={datePreset === preset.value ? "default" : "outline"}
                      className={cn(
                        "cursor-pointer text-xs px-2.5 py-1",
                        datePreset === preset.value && "bg-primary text-primary-foreground"
                      )}
                      onClick={() => applyDatePreset(datePreset === preset.value ? null : preset.value)}
                    >
                      {preset.label}
                    </Badge>
                  ))}
                </div>
                {datePreset === "custom" && (
                  <div className="flex gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className={cn("flex-1 justify-start text-left text-xs h-8", !startDate && "text-muted-foreground")}>
                          <CalendarIcon className="mr-1 h-3 w-3" />
                          {startDate ? format(startDate, "MMM d, yyyy") : "From"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={startDate} onSelect={setStartDate} className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className={cn("flex-1 justify-start text-left text-xs h-8", !endDate && "text-muted-foreground")}>
                          <CalendarIcon className="mr-1 h-3 w-3" />
                          {endDate ? format(endDate, "MMM d, yyyy") : "To"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={endDate} onSelect={setEndDate} className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </div>

              {/* Location + Radius */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="use-location"
                    checked={useLocation}
                    onCheckedChange={(checked) => setUseLocation(!!checked)}
                    disabled={!currentLocation}
                  />
                  <Label htmlFor="use-location" className="text-sm font-medium flex items-center gap-1.5 cursor-pointer">
                    <MapPin className="h-3.5 w-3.5" />
                    Filter by proximity
                  </Label>
                </div>
                {!currentLocation && (
                  <p className="text-xs text-muted-foreground ml-6">Location not available</p>
                )}
                {useLocation && currentLocation && (
                  <div className="space-y-1.5 ml-6">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Radius</span>
                      <span className="text-xs font-medium">{radiusKm} km</span>
                    </div>
                    <Slider
                      value={[radiusKm]}
                      onValueChange={([v]) => setRadiusKm(v)}
                      min={5}
                      max={100}
                      step={5}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>5 km</span>
                      <span>100 km</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          {/* Action buttons */}
          <div className="flex gap-2 px-4 py-3 border-t flex-shrink-0 bg-background">
            <Button variant="outline" className="flex-1 h-10" onClick={handleClear}>
              Clear All
            </Button>
            <Button className="flex-1 h-10" onClick={handleApply} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Apply Filters
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CompletedJobsFilterDrawer;
