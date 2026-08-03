import { useState } from "react";
import { Play, Loader2, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  /** vapi_calls.id — used to lazily fetch the recording URL when not provided. */
  callId?: string | null;
  /** Pass the URL directly when it is already loaded. */
  recordingUrl?: string | null;
  className?: string;
  size?: "sm" | "default";
}

/**
 * "Play Recording" control shown on every call record.
 * Renders an inline audio player once the recording is loaded, and a clear
 * "No recording" state when the provider did not return one.
 */
export default function CallRecordingPlayer({ callId, recordingUrl, className, size = "sm" }: Props) {
  const [url, setUrl] = useState<string | null>(recordingUrl ?? null);
  const [open, setOpen] = useState(Boolean(recordingUrl));
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = async () => {
    if (url) {
      setOpen(true);
      return;
    }
    if (!callId) {
      setMissing(true);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("vapi_calls")
      .select("recording_url")
      .eq("id", callId)
      .maybeSingle();
    setLoading(false);
    if (data?.recording_url) {
      setUrl(data.recording_url);
      setOpen(true);
    } else {
      setMissing(true);
    }
  };

  if (open && url) {
    return <audio controls src={url} className={`w-full ${className || ""}`} />;
  }

  if (missing) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className || ""}`}>
        <MicOff className="h-3 w-3" /> No recording available
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
