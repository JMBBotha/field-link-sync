/** Section-based visual proposal model (FreshBooks-style). */

export type ProposalSectionType = "richtext" | "pricing" | "attachments";

/** Rich-text presets — same block, different default copy. */
export type RichTextPreset = "blank" | "overview" | "scope" | "timeline";

export interface ProposalLineItem {
  id: string;
  description: string;
  /** Optional secondary multi-line description. */
  detail?: string;
  quantity: number;
  rate: number;
  /** Per-line VAT toggle. */
  taxable?: boolean;
}

export interface ProposalAttachment {
  id: string;
  name: string;
  /** Data URL or remote URL. */
  url: string;
  mime?: string;
}

export interface ProposalSection {
  id: string;
  type: ProposalSectionType;
  /** Heading for rich-text and pricing blocks. */
  title?: string;
  /** Rich-text HTML body (images inline). */
  html?: string;
  /** Placeholder copy for empty rich-text bodies. */
  placeholder?: string;
  /** Pricing block. */
  items?: ProposalLineItem[];
  discount?: number;
  /** Attachments block. */
  attachments?: ProposalAttachment[];
}

export type ProposalTemplateStyle = "simple" | "modern" | "classic";

export interface ProposalStyle {
  template: ProposalTemplateStyle;
  themeColor: string;
  font: string;
  /** Modern template hero image. */
  heroImage?: string;
}

export const DEFAULT_STYLE: ProposalStyle = {
  template: "simple",
  themeColor: "#1B3A5C",
  font: "Inter, system-ui, sans-serif",
};

export const THEME_COLORS = [
  { name: "Purple", value: "#6D4AFF" },
  { name: "Coral", value: "#E8543F" },
  { name: "Blue", value: "#1B77D6" },
  { name: "Green", value: "#2FAC66" },
  { name: "Slate", value: "#45566B" },
];

export const FONT_OPTIONS = [
  { name: "Inter (Sans)", value: "Inter, system-ui, sans-serif" },
  { name: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { name: "Georgia (Serif)", value: "Georgia, 'Times New Roman', serif" },
  { name: "Courier (Mono)", value: "'Courier New', monospace" },
];

export type ProposalStatus = "draft" | "sent" | "viewed" | "accepted" | "declined";

export const PROPOSAL_STATUSES: ProposalStatus[] = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
];

export const VAT_RATE = 0.15;

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const RICH_PRESETS: Record<RichTextPreset, { label: string; title: string; placeholder: string }> = {
  blank: {
    label: "Blank Section",
    title: "",
    placeholder: "Type to your heart's content or paste text and images here.",
  },
  overview: {
    label: "Overview",
    title: "Overview",
    placeholder:
      "Introduce the project and why your client should choose you. Summarise their needs and how you'll meet them.",
  },
  scope: {
    label: "Scope of Work",
    title: "Scope of Work",
    placeholder:
      "Describe the work to be done — equipment supplied, installation steps, commissioning and what's excluded.",
  },
  timeline: {
    label: "Timeline",
    title: "Timeline",
    placeholder:
      "Outline the project timing — start date, key milestones, installation days and hand-over.",
  },
};

export const RICH_PRESET_OPTIONS = (Object.keys(RICH_PRESETS) as RichTextPreset[]).map((k) => ({
  preset: k,
  label: RICH_PRESETS[k].label,
}));

export const richTextSection = (preset: RichTextPreset): ProposalSection => ({
  id: newId(),
  type: "richtext",
  title: RICH_PRESETS[preset].title,
  html: "",
  placeholder: RICH_PRESETS[preset].placeholder,
});

export const pricingSection = (): ProposalSection => ({
  id: newId(),
  type: "pricing",
  title: "Pricing",
  items: [],
  discount: 0,
});

export const attachmentsSection = (): ProposalSection => ({
  id: newId(),
  type: "attachments",
  title: "Attachments",
  attachments: [],
});

export const sectionSubtotal = (section: ProposalSection) =>
  (section.items || []).reduce(
    (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.rate) || 0),
    0,
  );

export const sectionVat = (section: ProposalSection) =>
  (section.items || []).reduce(
    (sum, i) =>
      sum + (i.taxable ? (Number(i.quantity) || 0) * (Number(i.rate) || 0) * VAT_RATE : 0),
    0,
  );

export const proposalSubtotal = (sections: ProposalSection[]) =>
  sections.reduce(
    (sum, s) =>
      sum + (s.type === "pricing" ? sectionSubtotal(s) - (Number(s.discount) || 0) : 0),
    0,
  );

export const proposalVat = (sections: ProposalSection[]) =>
  sections.reduce((sum, s) => sum + (s.type === "pricing" ? sectionVat(s) : 0), 0);

export const proposalTotal = (sections: ProposalSection[]) =>
  proposalSubtotal(sections) + proposalVat(sections);

export const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    Number.isFinite(n) && !Object.is(n, -0) ? n : 0,
  );
