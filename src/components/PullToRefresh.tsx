import React, { useState, useRef, useCallback, ReactNode } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

const PULL_THRESHOLD = 80;

const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  className = "",
  disabled = false,
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const hasTriggeredHaptic = useRef(false);

  const triggerHaptic = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Silently fail on web or unsupported platforms
    }
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    if (scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
      hasTriggeredHaptic.current = false;
    }
  }, [disabled, isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || disabled || isRefreshing) return;
    
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    if (scrollTop > 0) {
      isPulling.current = false;
      setPullDistance(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const distance = Math.max(0, currentY - touchStartY.current);
    // Apply resistance to pull
    const resistedDistance = Math.min(distance * 0.5, PULL_THRESHOLD * 1.5);
    setPullDistance(resistedDistance);

    // Trigger haptic when crossing threshold
    if (resistedDistance >= PULL_THRESHOLD && !hasTriggeredHaptic.current) {
      hasTriggeredHaptic.current = true;
      triggerHaptic();
    }
  }, [disabled, isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || disabled) return;
    
    isPulling.current = false;
    
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, onRefresh, disabled]);

  const indicatorProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const showIndicator = pullDistance > 10 || isRefreshing;

  return (
    <div
      ref={scrollContainerRef}
      className={`overflow-y-auto overscroll-contain ${className}`}
      style={{ 
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'thin',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="flex items-center justify-center transition-all duration-200 overflow-hidden"
        style={{
          height: showIndicator ? `${Math.max(pullDistance, isRefreshing ? 50 : 0)}px` : 0,
          opacity: showIndicator ? 1 : 0,
        }}
      >
        <div className="flex flex-col items-center gap-1">
          {isRefreshing ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <ArrowDown 
              className="h-5 w-5 text-muted-foreground transition-transform"
              style={{
                transform: `rotate(${indicatorProgress >= 1 ? 180 : 0}deg)`,
                opacity: indicatorProgress,
              }}
            />
          )}
          <span className="text-xs text-muted-foreground">
            {isRefreshing 
              ? "Refreshing..." 
              : indicatorProgress >= 1 
                ? "Release to refresh" 
                : "Pull to refresh"
            }
          </span>
        </div>
      </div>
      
      {children}
    </div>
  );
};

export default PullToRefresh;
