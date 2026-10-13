import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";

/** The five Grok voices a company can pick (same list as supabase/functions/_shared/mandyPolicy.ts). */
export const ASSISTANT_VOICES = [
  { id: "liora", label: "Liora (default)" },
  { id: "eve", label: "Eve" },
  { id: "ara", label: "Ara" },
  { id: "rex", label: "Rex" },
  { id: "leo", label: "Leo" },
] as const;

export type AssistantConfig = { bot_name: string; voice_id: string };
const DEFAULT: AssistantConfig = { bot_name: "Mandy", voice_id: "liora" };

/** This company's assistant name + voice (RLS: own company only). Falls back to Mandy/liora. */
export function useAssistantConfig() {
  const { companyId } = useUserCompanyId();
  const [cfg, setCfg] = useState<AssistantConfig>(DEFAULT);
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    (supabase as any).from("company_assistant_config").select("bot_name, voice_id").eq("company_id", companyId).maybeSingle()
      .then(({ data }: { data: AssistantConfig | null }) => { if (alive && data) setCfg({ bot_name: data.bot_name || "Mandy", voice_id: data.voice_id || "liora" }); });
    return () => { alive = false; };
  }, [companyId]);
  return { companyId, cfg, setCfg };
}
