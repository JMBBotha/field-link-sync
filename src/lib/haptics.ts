import { Capacitor } from "@capacitor/core";

/**
 * Trigger haptic feedback if running on a native device.
 * Falls back to a no-op on web.
 */
export async function hapticTap(style: "light" | "medium" | "heavy" = "medium") {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] });
  } catch {
    // Haptics not available
  }
}
