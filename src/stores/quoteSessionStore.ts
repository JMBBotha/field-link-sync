import { create } from "zustand";

interface LineItemDraft {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  service_id?: string | null;
}

interface DraftData {
  clientId: string | null;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  lineItems: LineItemDraft[];
  issueDate: string;
  dueDate: string;
  reference: string;
  notes: string;
  terms: string;
  leadId: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  showDiscount: boolean;
}

interface QuoteSessionState {
  quoteId: string | null;
  draftData: DraftData | null;
  isDirty: boolean;
  setQuoteId: (id: string | null) => void;
  setDraft: (data: Partial<DraftData>) => void;
  setDirty: (dirty: boolean) => void;
  clearDraft: () => void;
}

export const useQuoteSessionStore = create<QuoteSessionState>((set) => ({
  quoteId: null,
  draftData: null,
  isDirty: false,
  setQuoteId: (id) => set({ quoteId: id }),
  setDraft: (data) =>
    set((state) => ({
      draftData: { ...(state.draftData || getEmptyDraft()), ...data },
      isDirty: true,
    })),
  setDirty: (dirty) => set({ isDirty: dirty }),
  clearDraft: () => set({ quoteId: null, draftData: null, isDirty: false }),
}));

function getEmptyDraft(): DraftData {
  const now = new Date();
  const due = new Date();
  due.setDate(due.getDate() + 30);
  return {
    clientId: null,
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    clientAddress: "",
    lineItems: [{ description: "", quantity: 1, rate: 0, amount: 0 }],
    issueDate: now.toISOString().split("T")[0],
    dueDate: due.toISOString().split("T")[0],
    reference: "",
    notes: "",
    terms: "",
    leadId: "",
    discountType: "percent",
    discountValue: 0,
    showDiscount: false,
  };
}
