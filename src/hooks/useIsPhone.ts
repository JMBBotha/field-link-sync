import { useEffect, useState } from "react";

/** Phone = short side under 600px AND a touch screen. */
export function isPhoneViewport(width: number, height: number, touch: boolean): boolean {
  return Math.min(width, height) < 600 && touch;
}

function evaluate(): boolean {
  if (typeof window === "undefined") return false;
  const touch =
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
    (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0);
  return isPhoneViewport(window.innerWidth, window.innerHeight, touch);
}

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(() => evaluate());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsPhone(evaluate());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return isPhone;
}
