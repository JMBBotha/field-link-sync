/**
 * Quotes page "Voice quote" — now Mandy. She finds the client with her
 * find_client tool (one strong match or chips), speaks with her Grok voice,
 * and "new quote" opens the draft where quote mode builds the lines.
 */
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openMandyQuoteMode } from "@/lib/mandy/registry";

export default function VoiceQuoteStartDialog() {
  return (
    <Button type="button" variant="outline" className="gap-2" onClick={() => openMandyQuoteMode()} aria-label="Voice quote with Mandy">
      <Mic className="h-4 w-4" /> Voice quote
    </Button>
  );
}
