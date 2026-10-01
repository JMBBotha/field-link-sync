import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const WARNING_BEFORE = 60 * 1000; // 1 minute warning
const LAST = "fls:idle:last"; // shared last-activity ms (all tabs)
const TAB = "fls:idle:tab"; // tab with latest activity/focus: only it shows the warning
const tabId = Math.random().toString(36).slice(2);
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** 30-min idle logout shared by all tabs (localStorage + BroadcastChannel). Activity in any tab keeps
 *  every tab signed in; the 1-minute warning shows in the active tab only. enforce=false: count only. */
export const useIdleLogout = (enforce = true) => {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const showRef = useRef(false);
  const chan = useRef<BroadcastChannel | null>(null);
  const wrote = useRef(0);

  const touch = useCallback((force = false) => {
    const now = Date.now();
    set(TAB, tabId);
    if (!force && now - wrote.current < 5000) return; // throttle mousemove/scroll
    wrote.current = now;
    set(LAST, String(now));
    chan.current?.postMessage("activity");
  }, []);

  const stayActive = useCallback(() => {
    showRef.current = false;
    setShowWarning(false);
    touch(true);
  }, [touch]);

  useEffect(() => {
    let done = false;
    chan.current = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fls-idle") : null;
    const logout = async (tell: boolean) => {
      if (done) return;
      done = true;
      if (tell) chan.current?.postMessage("logout");
      try {
        // Local scope: an idle desktop must not revoke the phone's session.
        await supabase.auth.signOut({ scope: "local" });
      } catch (err) {
        console.error("useIdleLogout signOut error:", err);
      }
      navRef.current("/login");
    };
    const tick = () => {
      if (!enforce || done) return;
      const idle = Date.now() - (Number(get(LAST)) || Date.now());
      if (idle >= IDLE_TIMEOUT) return void logout(true);
      const warn = idle >= IDLE_TIMEOUT - WARNING_BEFORE && get(TAB) === tabId;
      showRef.current = warn;
      setShowWarning(warn);
      if (warn) setSecondsLeft(Math.ceil((IDLE_TIMEOUT - idle) / 1000));
    };
    const onActivity = () => { if (!showRef.current) touch(); };
    const onFocus = () => set(TAB, tabId);
    const onMsg = (e: MessageEvent) => (e.data === "logout" ? void logout(false) : tick());
    const events = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    window.addEventListener("focus", onFocus);
    chan.current?.addEventListener("message", onMsg);
    touch(true); // opening the app counts as activity
    const iv = setInterval(tick, 1000);
    return () => {
      done = true;
      clearInterval(iv);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      window.removeEventListener("focus", onFocus);
      chan.current?.close();
      chan.current = null;
    };
  }, [enforce, touch]);

  return { showWarning, secondsLeft, stayActive };
};
