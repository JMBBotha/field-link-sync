import { useState, useRef, useCallback, useEffect } from "react";

interface PdfMagnifierProps {
  active: boolean;
  imageUrl: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  baseZoom: number;
}

const PdfMagnifier = ({ active, imageUrl, containerRef, baseZoom }: PdfMagnifierProps) => {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);
  const [mag, setMag] = useState(2.5);
  const [showLevel, setShowLevel] = useState(false);
  const levelTimer = useRef<ReturnType<typeof setTimeout>>();
  const lensSize = 190;
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Find the img inside the container
  const getImg = useCallback(() => {
    if (!containerRef.current) return null;
    return containerRef.current.querySelector("img") as HTMLImageElement | null;
  }, [containerRef]);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    const img = getImg();
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      setVisible(false);
      return;
    }
    setVisible(true);
    // Position relative to the container (scrollable parent)
    const containerRect = containerRef.current!.getBoundingClientRect();
    setPos({
      x: clientX - containerRect.left + containerRef.current!.scrollLeft,
      y: clientY - containerRect.top + containerRef.current!.scrollTop,
    });
  }, [getImg, containerRef]);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    const el = containerRef.current;

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onMouseLeave = () => setVisible(false);
    const onWheel = (e: WheelEvent) => {
      if (!visible) return;
      e.preventDefault();
      setMag(m => Math.min(5, Math.max(1.5, m + (e.deltaY > 0 ? -0.25 : 0.25))));
      setShowLevel(true);
      clearTimeout(levelTimer.current);
      levelTimer.current = setTimeout(() => setShowLevel(false), 800);
    };

    // Touch support
    let touchTimer: ReturnType<typeof setTimeout>;
    let touchActive = false;
    const onTouchStart = (e: TouchEvent) => {
      touchTimer = setTimeout(() => {
        touchActive = true;
        const t = e.touches[0];
        handleMove(t.clientX, t.clientY);
      }, 400);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchActive) return;
      e.preventDefault();
      const t = e.touches[0];
      // Offset upward so finger doesn't cover lens
      handleMove(t.clientX, t.clientY - 80);
    };
    const onTouchEnd = () => {
      clearTimeout(touchTimer);
      touchActive = false;
      setVisible(false);
    };

    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mouseleave", onMouseLeave);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("mouseleave", onMouseLeave);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      clearTimeout(levelTimer.current);
    };
  }, [active, containerRef, handleMove, visible]);

  if (!active || !visible) return null;

  const img = getImg();
  if (!img) return null;

  const rect = img.getBoundingClientRect();
  const containerRect = containerRef.current!.getBoundingClientRect();

  // Cursor position relative to natural image
  const cursorXInImg = (pos.x - (rect.left - containerRect.left + containerRef.current!.scrollLeft)) / rect.width;
  const cursorYInImg = (pos.y - (rect.top - containerRect.top + containerRef.current!.scrollTop)) / rect.height;

  const bgW = rect.width * mag;
  const bgH = rect.height * mag;
  const bgX = -(cursorXInImg * bgW - lensSize / 2);
  const bgY = -(cursorYInImg * bgH - lensSize / 2);

  return (
    <div
      className="absolute pointer-events-none z-[60]"
      style={{
        width: lensSize,
        height: lensSize,
        borderRadius: "50%",
        border: "2.5px solid hsl(var(--border))",
        boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.1) inset",
        overflow: "hidden",
        transform: `translate(${pos.x - lensSize / 2}px, ${pos.y - lensSize / 2}px)`,
        willChange: "transform",
        top: 0,
        left: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: `${bgW}px ${bgH}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          backgroundRepeat: "no-repeat",
        }}
      />
      {/* Center dot */}
      <div
        className="absolute rounded-full bg-primary/60"
        style={{
          width: 4, height: 4,
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
      {/* Zoom level indicator */}
      {showLevel && (
        <div
          className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-black/70 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
        >
          {mag.toFixed(1)}×
        </div>
      )}
    </div>
  );
};

export default PdfMagnifier;
