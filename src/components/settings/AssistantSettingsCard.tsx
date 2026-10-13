import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Bot, Play } from "lucide-react";
import { ASSISTANT_VOICES, useAssistantConfig } from "@/hooks/useAssistantConfig";

/** Company admins pick their assistant's name and one of five voices. Tools, rules and tone come from the main system. */
export default function AssistantSettingsCard() {
  const { companyId, cfg, setCfg } = useAssistantConfig();
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);

  const save = async () => {
    if (!companyId) return;
    const name = cfg.bot_name.replace(/[^\p{L}\p{N} '\-]/gu, "").trim().slice(0, 24) || "Mandy";
    setSaving(true);
    const { error } = await (supabase as any).from("company_assistant_config")
      .upsert({ company_id: companyId, bot_name: name, voice_id: cfg.voice_id }, { onConflict: "company_id" });
    setSaving(false);
    setCfg({ ...cfg, bot_name: name });
    toast(error ? { title: "Save failed", description: error.message, variant: "destructive" } : { title: "Assistant saved", description: "Reload the page to hear the new voice." });
  };

  const preview = async (voice: string) => {
    setPlaying(voice);
    try {
      const { data } = await supabase.functions.invoke("mandy-agent", {
        body: { action: "tts", preview_voice: voice, text: `Hi, I'm ${cfg.bot_name || "Mandy"}. How can I help you today?`, client_build: "dev" },
      });
      const b64 = (data as { audio_base64?: string; mime?: string } | null)?.audio_base64;
      if (b64) await new Audio(`data:${(data as any).mime || "audio/mpeg"};base64,${b64}`).play();
    } finally { setPlaying(null); }
  };

  return (
    <Card className="mt-4" data-testid="assistant-settings">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> Work assistant</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="bot-name">Assistant name</label>
          <Input id="bot-name" maxLength={24} value={cfg.bot_name} onChange={(e) => setCfg({ ...cfg, bot_name: e.target.value })} className="max-w-xs" />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Voice</div>
          <div className="grid gap-2 sm:grid-cols-5">
            {ASSISTANT_VOICES.map((v) => (
              <div key={v.id} className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-sm ${cfg.voice_id === v.id ? "border-primary bg-primary/5" : "border-border"}`}>
                <button type="button" className="flex-1 text-left" onClick={() => setCfg({ ...cfg, voice_id: v.id })} aria-pressed={cfg.voice_id === v.id}>{v.label}</button>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={!!playing} onClick={() => preview(v.id)} aria-label={`Play ${v.label}`}><Play className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Tone, tools and rules are the same for every company and come from the main system. The assistant can't change settings, pricing, the catalogue, templates or users, and asks "Send this?" before anything goes to a client.</p>
        <Button onClick={save} disabled={saving || !companyId}>{saving ? "Saving…" : "Save assistant"}</Button>
      </CardContent>
    </Card>
  );
}
