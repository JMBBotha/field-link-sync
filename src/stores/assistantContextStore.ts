import { create } from "zustand";

/**
 * Live "what is the operator doing right now" context for the voice assistant.
 *
 * Kept deliberately tiny — it is pushed to the voice session on every change
 * and is treated by the backend as a hint only (never for authorisation).
 */
export interface AssistantUiContext {
  user_id?: string;
  user_name?: string;
  company_id?: string;
  current_page?: string;
  route?: string;
  open_quote_id?: string;
  open_quote_number?: string;
  open_quote_status?: string;
  open_invoice_id?: string;
  open_job_id?: string;
  open_lead_id?: string;
  selected_customer_id?: string;
  selected_customer_name?: string;
  last_search_query?: string;
  notes?: string;
}

interface AssistantContextState {
  context: AssistantUiContext;
  /** Shallow-merge a patch; undefined/null values clear the key. */
  setContext: (patch: Partial<AssistantUiContext>) => void;
  clearKeys: (keys: (keyof AssistantUiContext)[]) => void;
}

const clean = (ctx: AssistantUiContext): AssistantUiContext => {
  const out: AssistantUiContext = {};
  (Object.keys(ctx) as (keyof AssistantUiContext)[]).forEach((k) => {
    const v = ctx[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 160);
  });
  return out;
};

export const useAssistantContextStore = create<AssistantContextState>((set) => ({
  context: {},
  setContext: (patch) =>
    set((state) => {
      const next = clean({ ...state.context, ...patch } as AssistantUiContext);
      // Skip re-renders / network pushes when nothing actually changed.
      if (JSON.stringify(next) === JSON.stringify(state.context)) return state;
      return { context: next };
    }),
  clearKeys: (keys) =>
    set((state) => {
      const next = { ...state.context };
      keys.forEach((k) => delete next[k]);
      if (JSON.stringify(next) === JSON.stringify(state.context)) return state;
      return { context: next };
    }),
}));

/** Read-only snapshot for non-React callers (e.g. the voice hook). */
export const getAssistantContext = () => useAssistantContextStore.getState().context;

/** Imperative setter for non-React callers. */
export const setAssistantContext = (patch: Partial<AssistantUiContext>) =>
  useAssistantContextStore.getState().setContext(patch);
