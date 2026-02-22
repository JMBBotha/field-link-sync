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

    let cleanup: (() => void) | undefined;

    import("@capacitor/app").then(({ App }) => {
      const listener = App.addListener("backButton", (ev) => {
        // Prevent default back navigation
        onBack();
      });
      listener.then((handle) => {
        cleanup = () => handle.remove();
      });
    }).catch(() => {
      // App plugin not available
    });

    return () => {
      cleanup?.();
    };
  }, [active, onBack]);
}
