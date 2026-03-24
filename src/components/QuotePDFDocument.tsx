import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Font, Image,
} from "@react-pdf/renderer";
import { TERMS_BLOCKS, type TermsBlock } from "@/lib/defaultTerms";

/* ─── Font registration ─── */
Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf", fontWeight: 400 },
    { src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf", fontWeight: 700 },
  ],
});

/* ─── Types ─── */
export interface QuotePDFSubItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  pricingMode?: "per-unit" | "per-meter";
}

export interface QuotePDFLineItem {
  areaName: string;
  unitName: string;
  btu: number;
  quantity: number;
  unitPrice: number;
  markupPercent: number;
  lineTotal: number;
  subItems?: QuotePDFSubItem[];
}

export interface QuotePDFData {
  quoteNumber: string;
  date: string;
  validUntil: string;
  clientName: string;
  clientEmail: string;
  items: QuotePDFLineItem[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  logoUrl?: string | null;
}

/* ─── Helpers ─── */
function formatZAR(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

/* ─── Styles ─── */
const ACCENT = "#0EA5E9";
const BLUE = "#1e40af";
const BLUE_LIGHT = "#eff6ff";
const GOLD = "#F59E0B";
const GRAY = "#6b7280";
const DARK = "#111827";

const s = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 9, padding: 40, paddingBottom: 60, color: DARK },
  /* Header */
  header: { marginBottom: 0 },
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  brandName: { fontSize: 18, fontWeight: 700, color: BLUE, letterSpacing: 0.5 },
  brandTagline: { fontSize: 8, color: GRAY },
  goldStripe: { height: 6, backgroundColor: GOLD, borderRadius: 3, marginBottom: 16 },
  /* Meta row */
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  metaBlock: {},
  metaLabel: { fontSize: 8, color: GRAY, marginBottom: 1 },
  metaValue: { fontSize: 10, fontWeight: 700 },
  /* Table */
  tableHeader: { flexDirection: "row", backgroundColor: BLUE_LIGHT, borderBottomWidth: 1, borderBottomColor: "#dbeafe", paddingVertical: 6, paddingHorizontal: 4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 5, paddingHorizontal: 4 },
  colDesc: { flex: 3 },
  colQty: { flex: 0.8, textAlign: "center" as const },
  colUnit: { flex: 1.2, textAlign: "right" as const },
  colMarkup: { flex: 1, textAlign: "center" as const },
  colTotal: { flex: 1.2, textAlign: "right" as const },
  thText: { fontSize: 8, fontWeight: 700, color: BLUE },
  tdText: { fontSize: 9 },
  tdSub: { fontSize: 7, color: GRAY, marginTop: 1 },
  /* Totals */
  totalsBox: { marginTop: 12, alignSelf: "flex-end" as const, width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsFinal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, backgroundColor: BLUE, borderRadius: 4, paddingHorizontal: 8, marginTop: 4 },
  totalsFinalLabel: { fontSize: 10, fontWeight: 700, color: "#ffffff" },
  totalsFinalValue: { fontSize: 10, fontWeight: 700, color: "#ffffff" },
  /* Sub-items */
  subRow: { flexDirection: "row", backgroundColor: "#fafafa", paddingVertical: 3, paddingHorizontal: 4, paddingLeft: 16 },
  subText: { fontSize: 7.5, color: GRAY },
  subTextBold: { fontSize: 7.5, color: DARK, fontWeight: 700 },

  /* ─── T&C Page Styles ─── */
  tcPage: { fontFamily: "Roboto", fontSize: 9, padding: 40, paddingTop: 30, paddingBottom: 72, color: DARK },
  tcHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 12,
  },
  tcHeaderLeft: { flexDirection: "row" as const, alignItems: "center" as const },
  tcLogo: { width: 36, height: 36, marginRight: 8 },
  tcHeaderBrand: { fontSize: 14, fontWeight: "bold", color: ACCENT },
  tcHeaderSubtitle: { fontSize: 7, color: GRAY },
  tcHeaderTitle: { fontSize: 20, fontWeight: "bold", color: ACCENT },
  tcTopBorder: { borderTopWidth: 1, borderTopColor: ACCENT, marginBottom: 12 },
  tcMainTitle: { fontSize: 20, fontWeight: "bold", color: ACCENT, textAlign: "center" as const, marginBottom: 10 },

  /* Terms content */
  termsTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 8, color: ACCENT, textAlign: "center" as const },
  termsHeading: { fontSize: 10, fontWeight: "bold", color: ACCENT, marginTop: 10, marginBottom: 3 },
  termsParagraph: { fontSize: 8, color: DARK, marginBottom: 3, lineHeight: 1.5 },
  termsBullet: { fontSize: 8, color: DARK, marginBottom: 2, lineHeight: 1.5, paddingLeft: 10 },
  termsBanking: { fontSize: 8.5, fontWeight: "bold", color: DARK, marginBottom: 2, textAlign: "center" as const },
  termsSpacer: { height: 6 },

  /* T&C Footer */
  tcFooterText: {
    position: "absolute" as const,
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: ACCENT,
    paddingTop: 6,
    fontSize: 7,
    color: GRAY,
    textAlign: "center" as const,
  },

  /* Quote page footer */
  footer: { position: "absolute" as const, bottom: 30, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: "#d1d5db", paddingTop: 8 },
  footerText: { fontSize: 7, color: GRAY },
});

/* ─── T&C Header (fixed on each T&C page) ─── */
function TCHeader({ logoUrl }: { logoUrl?: string | null }) {
  return (
    <View style={s.tcHeader} fixed>
      <View style={s.tcHeaderLeft}>
        {logoUrl && <Image src={logoUrl} style={s.tcLogo} />}
        <View>
          <Text style={s.tcHeaderBrand}>0800-BE-COOL!</Text>
          <Text style={s.tcHeaderSubtitle}>AC Super Service</Text>
        </View>
      </View>
      <Text style={s.tcHeaderTitle}>Terms & Conditions</Text>
    </View>
  );
}

/* ─── T&C Footer (fixed on each T&C page) ─── */
function TCFooter() {
  return (
    <Text style={s.tcFooterText} fixed>
      0800-BE-COOL AC Super Service | www.0800becool.co.za
    </Text>
  );
}

/* ─── Terms block renderer ─── */
function TermsBlockRenderer({ block }: { block: TermsBlock }) {
  switch (block.type) {
    case "title":
      return <Text style={s.termsTitle}>{block.text}</Text>;
    case "heading":
      return <Text style={s.termsHeading}>{block.text}</Text>;
    case "paragraph":
      return <Text style={s.termsParagraph}>{block.text}</Text>;
    case "bullet":
      return (
        <Text style={s.termsBullet}>
          {"• "}{block.boldPrefix ? <Text style={{ fontWeight: "bold" }}>{block.boldPrefix}: </Text> : null}
          {block.boldPrefix ? block.text.slice(block.boldPrefix.length + 2) : block.text}
        </Text>
      );
    case "banking":
      return <Text style={s.termsBanking}>{block.text}</Text>;
    case "spacer":
      return <View style={s.termsSpacer} />;
    default:
      return null;
  }
}

/* ─── Document Component ─── */
export default function QuotePDFDocument({ data }: { data: QuotePDFData }) {
  return (
    <Document>
      {/* ── Quote Page ── */}
      <Page size="A4" style={s.page}>
...
      {/* ── Terms & Conditions Page(s) ── */}
      <Page size="A4" style={s.tcPage} wrap>
        <TCHeader logoUrl={data.logoUrl} />
        <View style={s.tcTopBorder} />
        <Text style={s.tcMainTitle}>Terms & Conditions</Text>

        {TERMS_BLOCKS.map((block, i) => (
          <TermsBlockRenderer key={i} block={block} />
        ))}

        <TCFooter />
      </Page>
    </Document>
  );
}
