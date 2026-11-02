import { supabase } from "@/integrations/supabase/client";

export const PUSH_SW_PATH = "/push-sw.js";
export const isPushWorkerUrl = (url: string) => /\/push-sw\.js(\?|$)/.test(url || "");

export type PushSupport = "supported" | "ios-home-screen" | "unsupported" | "no-key";

export function pushSupport(env: { ua?: string; standalone?: boolean; hasSW?: boolean; hasPush?: boolean; key?: string } = {}): PushSupport {
  const ua = env.ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const standalone = env.standalone ?? (typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true));
  const hasSW = env.hasSW ?? (typeof navigator !== "undefined" && "serviceWorker" in navigator);
  const hasPush = env.hasPush ?? (typeof window !== "undefined" && "PushManager" in window);
  const key = env.key ?? (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined);
  const ios = /iPhone|iPad|iPod/.test(ua);
  if (ios && !standalone) return "ios-home-screen"; // iOS 16.4+: only from the home-screen app
  if (!hasSW || !hasPush) return "unsupported";
  if (!key) return "no-key";
  return "supported";
}

export function urlB64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function reg() {
  return (await navigator.serviceWorker.getRegistration(PUSH_SW_PATH)) ?? navigator.serviceWorker.register(PUSH_SW_PATH);
}

export async function currentPushSubscription() {
  const r = await navigator.serviceWorker.getRegistration(PUSH_SW_PATH);
  return (await r?.pushManager.getSubscription()) ?? null;
}

/** Only called from an explicit tap on the opt-in switch. */
export async function enablePush(): Promise<boolean> {
  if ((await Notification.requestPermission()) !== "granted") return false;
  const r = await reg();
  const sub = await r.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY as string) as BufferSource,
  });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await (supabase as any).from("push_subscriptions").upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
    { onConflict: "endpoint" });
  if (error) { await sub.unsubscribe(); throw error; }
  return true;
}

/** Opt-out: removes this device's subscription from the browser and the database. */
export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await (supabase as any).from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
