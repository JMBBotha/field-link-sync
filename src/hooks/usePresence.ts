import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface PresenceState {
  user_id: string;
  online_at: string;
}

export const usePresence = (channelName = "admin-presence") => {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;

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
          if (status === "SUBSCRIBED") {
            if (cancelled) return;
            channel
              .track({
                user_id: session.user.id,
                online_at: new Date().toISOString(),
              })
              .catch((err) => console.error("usePresence track error:", err));
          }
        });

      // If unmount happened while awaiting getSession, tear the channel down now
      // — channelRef would otherwise leak past cleanup.
      if (cancelled) {
        void supabase.removeChannel(channel);
        return;
      }
      channelRef.current = channel;
    };

    init().catch((err) => console.error("usePresence init error:", err));

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [channelName]);

  return { onlineUsers, isOnline: (userId: string) => onlineUsers.has(userId) };
};
