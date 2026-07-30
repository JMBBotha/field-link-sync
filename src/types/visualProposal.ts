export type ProposalSectionType =
  | "cover"
  | "text"
  | "image"
  | "pricing"
  | "signature";

export interface ProposalLineItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
}

export interface ProposalSection {
  id: string;
  type: ProposalSectionType;
  /** Cover: headline. Text/Image/Pricing: section heading. */
  title?: string;
  /** Cover subheadline. */
  subtitle?: string;
  /** Text block body (light markdown: **bold**, *italic*, # heading, - bullet). */
  body?: string;
  /** Cover hero image / image block source (URL or data URL). */
  imageUrl?: string;
  caption?: string;
  items?: ProposalLineItem[];
  /** Signature block. */
  signerName?: string;
  signedAt?: string | null;
}

export type ProposalStatus = "draft" | "sent" | "viewed" | "accepted" | "declined";

export const PROPOSAL_STATUSES: ProposalStatus[] = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
];

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const blankSection = (type: ProposalSectionType): ProposalSection => {
  const base: ProposalSection = { id: newId(), type };
  switch (type) {
    case "cover":
      return { ...base, title: "Proposal", subtitle: "Prepared for our valued client" };
    case "text":
      return { ...base, title: "About this project", body: "" };
    case "image":
      return { ...base, title: "", imageUrl: "", caption: "" };
    case "pricing":
      return { ...base, title: "Investment", items: [] };
    case "signature":
      return { ...base, title: "Acceptance", signerName: "", signedAt: null };
  }
};

export const sectionSubtotal = (section: ProposalSection) =>
  (section.items || []).reduce(
    (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.rate) || 0),
    0,
  );

export const proposalTotal = (sections: ProposalSection[]) =>
  sections.reduce((sum, s) => sum + (s.type === "pricing" ? sectionSubtotal(s) : 0), 0);

export const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    Number.isFinite(n) ? n : 0,
  );
