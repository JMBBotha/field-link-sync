import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * On native platforms, intercept the hardware back button
 * and call `onBack` instead of navigating away.
 * Useful for preventing users from accidentally leaving a wizard mid-flow.
 */
export function useBackButtonGuard(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active || !Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    import("@capacitor/app")
      .then(({ App }) => {
        if (cancelled) return;
        const listenerPromise = App.addListener("backButton", () => {
          onBack();
        });
        listenerPromise
          .then((handle) => {
            if (cancelled) {
              handle.remove();
              return;
            }
            cleanup = () => handle.remove();
          })
          .catch((err) => console.error("[useBackButtonGuard] listener error", err));
      })
      .catch(() => {
        // App plugin not available
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [active, onBack]);
}
