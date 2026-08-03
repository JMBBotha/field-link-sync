import { useState } from "react";
import { Play, Loader2, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  /** vapi_calls.id — recordings are streamed through the get-call-recording function. */
  callId?: string | null;
  /** Kept for API compatibility; playback always goes through the proxy. */
  recordingUrl?: string | null;
  className?: string;
  size?: "sm" | "default";
}

/**
 * "Play Recording" control shown on every call record.
 * The audio is fetched through an edge function which verifies the recording is
 * actually retrievable — so we never render a broken 0:00 / 0:00 player.
 */
export default function CallRecordingPlayer({ callId, recordingUrl, className, size = "sm" }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(
    callId ? null : recordingUrl ? null : "No recording available",
  );

  const load = async () => {
    if (src) return;
    if (!callId) {
      setUnavailable("No recording available");
      return;
    }
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-call-recording?id=${encodeURIComponent(callId)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
      });

      if (!res.ok) {
        let reason = "No recording available";
        try {
          const body = await res.json();
          if (body?.reason) reason = body.reason;
        } catch {
          /* keep default */
        }
        setUnavailable(reason);
        return;
      }

      const blob = await res.blob();
      if (!blob.size) {
        setUnavailable("No recording available");
        return;
      }
      setSrc(URL.createObjectURL(blob));
    } catch (e) {
      console.error("Recording load failed:", e);
      setUnavailable("Recording could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  if (src) {
    return <audio controls src={src} className={`w-full ${className || ""}`} />;
  }

  if (unavailable) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className || ""}`}>
        <MicOff className="h-3 w-3" /> {unavailable}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      disabled={loading}
      onClick={(e) => {
        e.stopPropagation();
        load();
      }}
    >
      {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
      Play recording
    </Button>
  );
}
