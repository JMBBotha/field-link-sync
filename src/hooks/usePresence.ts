import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";

interface PresenceState {
  user_id: string;
  online_at: string;
}

export const usePresence = (channelName = "admin-presence") => {
  const { session } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const channel = supabase.channel(channelName, {
      config: { presence: { key: session.user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceState>();
        const ids = new Set<string>();
        Object.values(state).forEach((presences) => {
          presences.forEach((p) => {
            if (p.user_id) ids.add(p.user_id);
          });
        });
        if (!cancelled) setOnlineUsers(ids);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !cancelled) {
          channel
            .track({
              user_id: session.user.id,
              online_at: new Date().toISOString(),
            })
            .catch((err) => console.error("usePresence track error:", err));
        }
      });

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [channelName, session]);

  return { onlineUsers, isOnline: (userId: string) => onlineUsers.has(userId) };
};
