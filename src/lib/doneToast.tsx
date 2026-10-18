import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

/** R3 done state: what happened + who, the time (SAST), and one next-step button. */
export const doneTime = (d: Date = new Date()) =>
  d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });

export function doneMessage(what: string, at: Date = new Date()) {
  return `${what} · ${doneTime(at)}`;
}

export function doneToast(what: string, next?: { label: string; onClick: () => void }, at?: Date) {
  return toast({
    title: doneMessage(what, at),
    action: next ? <ToastAction altText={next.label} onClick={next.onClick}>{next.label}</ToastAction> : undefined,
  });
}
