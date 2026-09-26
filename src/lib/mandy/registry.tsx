import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { create } from "zustand";
import type { MandyHandler } from "./actions";
import { unlockMandyVoiceFromTap } from "./voiceUnlock";

export type MandyMode = "default" | "quote";

/** Dock visibility — the header "Ask Mandy" button opens it. */
export const useMandyDock = create<{
  open: boolean; setOpen: (v: boolean) => void; listenRequest: number; openAndListen: () => void;
  /** "quote": every utterance goes to the page's quote_scene handler (Grok plan → breakdown card). */
  mode: MandyMode; setMode: (m: MandyMode) => void;
  /** Pages ask the dock to speak (Grok voice eve, shared speed) — e.g. after a card Confirm. */
  speakRequest: { text: string; n: number } | null; say: (text: string) => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set(open ? { open } : { open, mode: "default" }),
  listenRequest: 0,
  openAndListen: () => set((s) => ({ open: true, listenRequest: s.listenRequest + 1 })),
  mode: "default",
  setMode: (mode) => set({ mode }),
  speakRequest: null,
  say: (text) => set((s) => ({ speakRequest: { text, n: (s.speakRequest?.n ?? 0) + 1 } })),
}));

/** "Build with voice" / quote mic: open Mandy listening in quote mode (must run inside the tap). */
export function openMandyQuoteMode(close?: () => void) {
  useMandyDock.getState().setMode("quote");
  openMandyVoice(close);
}

/** The ONE voice entry point: close whatever panel asked, open Mandy listening. */
export function openMandyVoice(close?: () => void) {
  unlockMandyVoiceFromTap(); // synchronous: must run inside the tap
  close?.();
  useMandyDock.getState().openAndListen();
}

interface Registry {
  register: (handlers: Record<string, MandyHandler>) => () => void;
  get: (name: string) => MandyHandler | undefined;
  names: () => string[];
}

const Ctx = createContext<Registry | null>(null);

/** Mounted above the routes so the dock survives navigation. */
export function MandyActionsProvider({ children }: { children: ReactNode }) {
  const mapRef = useRef(new Map<string, MandyHandler>());
  const value = useMemo<Registry>(() => ({
    register: (handlers) => {
      Object.entries(handlers).forEach(([k, h]) => mapRef.current.set(k, h));
      return () => {
        Object.entries(handlers).forEach(([k, h]) => {
          if (mapRef.current.get(k) === h) mapRef.current.delete(k);
        });
      };
    },
    get: (n) => mapRef.current.get(n),
    names: () => [...mapRef.current.keys()],
  }), []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMandyRegistry() {
  return useContext(Ctx);
}

/**
 * Pages register their handlers. Handlers are read through a ref, so they
 * always see fresh state without re-registering on every render.
 */
export function useRegisterMandyActions(handlers: Record<string, MandyHandler>) {
  const reg = useContext(Ctx);
  const ref = useRef(handlers);
  ref.current = handlers;
  const keys = Object.keys(handlers).sort().join(",");
  useEffect(() => {
    if (!reg) return;
    const stable: Record<string, MandyHandler> = {};
    keys.split(",").filter(Boolean).forEach((k) => {
      stable[k] = (args) => ref.current[k](args);
    });
    return reg.register(stable);
  }, [reg, keys]);
}
