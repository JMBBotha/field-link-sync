import { useState, useRef, useCallback } from 'react';
import { Trash2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

interface SwipeablePhotoProps {
  id: string;
  url: string;
  caption?: string | null;
  photoType: 'before' | 'after';
  isQueued: boolean;
  onClick: () => void;
  onDelete: () => void;
  deleting?: boolean;
}

const SWIPE_THRESHOLD = 80;
const DELETE_THRESHOLD = 120;

// Safe haptic feedback that won't crash on web
const triggerHaptic = async (type: 'threshold' | 'delete') => {
  try {
    if (type === 'threshold') {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } else {
      await Haptics.notification({ type: NotificationType.Warning });
    }
  } catch {
    // Haptics not available (web browser)
  }
};

export function SwipeablePhoto({
  url,
  caption,
  photoType,
  isQueued,
  onClick,
  onDelete,
  deleting,
}: SwipeablePhotoProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isHorizontalSwipe = useRef<boolean | null>(null);
  const hasTriggeredHaptic = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = null;
    hasTriggeredHaptic.current = false;
    setSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = startX.current - currentX;
    const diffY = Math.abs(currentY - startY.current);

    // Determine swipe direction on first significant movement
    if (isHorizontalSwipe.current === null) {
      if (Math.abs(diffX) > 10 || diffY > 10) {
        isHorizontalSwipe.current = Math.abs(diffX) > diffY;
      }
    }

    // Only handle horizontal swipes (left swipe = positive diffX)
    if (isHorizontalSwipe.current && diffX > 0) {
      e.preventDefault();
      const newOffset = Math.min(diffX, DELETE_THRESHOLD + 20);
      
      // Trigger haptic when crossing delete threshold
      if (newOffset >= DELETE_THRESHOLD && !hasTriggeredHaptic.current) {
        hasTriggeredHaptic.current = true;
        triggerHaptic('threshold');
      } else if (newOffset < DELETE_THRESHOLD && hasTriggeredHaptic.current) {
        // Reset if user moves back below threshold
        hasTriggeredHaptic.current = false;
      }
      
      setOffsetX(newOffset);
    }
  }, [swiping]);

  const handleTouchEnd = useCallback(() => {
    setSwiping(false);
    
    if (offsetX >= DELETE_THRESHOLD) {
      // Trigger delete with haptic
      triggerHaptic('delete');
      onDelete();
    }
    
    // Reset position
    setOffsetX(0);
    isHorizontalSwipe.current = null;
    hasTriggeredHaptic.current = false;
  }, [offsetX, onDelete]);

  const handleClick = useCallback(() => {
    // Only trigger click if not swiping
    if (offsetX === 0) {
      onClick();
    }
  }, [offsetX, onClick]);

  const deleteProgress = Math.min(offsetX / DELETE_THRESHOLD, 1);
  const showDeleteHint = offsetX > SWIPE_THRESHOLD;

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Delete background */}
      <div 
        className="absolute inset-0 bg-red-500 flex items-center justify-end pr-4 rounded-lg"
        style={{ opacity: deleteProgress * 0.9 + 0.1 }}
      >
        <div className="flex flex-col items-center text-white">
          <Trash2 
            className="transition-transform" 
            style={{ 
              width: `${16 + deleteProgress * 8}px`,
              height: `${16 + deleteProgress * 8}px`,
            }} 
          />
          {showDeleteHint && (
            <span className="text-[10px] mt-0.5 font-medium">Release</span>
          )}
        </div>
      </div>

      {/* Photo container */}
      <div
        className="relative bg-muted rounded-lg transition-transform touch-pan-y"
        style={{
          transform: `translateX(-${offsetX}px)`,
          transition: swiping ? 'none' : 'transform 0.2s ease-out',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <button
          onClick={handleClick}
          disabled={deleting}
          className={`w-full aspect-square rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary ${
            isQueued ? 'opacity-80' : ''
          }`}
        >
          <img
            src={url}
            alt={caption || `${photoType} photo`}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable={false}
          />
        </button>

        {/* Status badge */}
        {isQueued && (
          <div className="absolute top-1 left-1 pointer-events-none">
            <Badge className="bg-yellow-500/90 text-[10px] px-1.5 py-0 h-4">
              <Clock className="h-2.5 w-2.5 mr-0.5" />
              Queued
            </Badge>
          </div>
        )}

        {/* Swipe hint indicator */}
        {offsetX === 0 && (
          <div className="absolute bottom-1 right-1 pointer-events-none opacity-50">
            <span className="text-[8px] text-white bg-black/40 px-1 rounded">
              ← swipe
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
