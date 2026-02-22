import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Font,
} from "@react-pdf/renderer";

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
  /** Materials/consumables sub-items for this area */
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
}

/* ─── Helpers ─── */
function formatZAR(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

/* ─── Styles ─── */
const BLUE = "#1e40af";
const BLUE_LIGHT = "#eff6ff";
const GOLD = "#F59E0B";
const GRAY = "#6b7280";
const DARK = "#111827";

const s = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 9, padding: 40, color: DARK },
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
  /* Sub-items (materials/consumables) */
  subRow: { flexDirection: "row", backgroundColor: "#fafafa", paddingVertical: 3, paddingHorizontal: 4, paddingLeft: 16 },
  subText: { fontSize: 7.5, color: GRAY },
  subTextBold: { fontSize: 7.5, color: DARK, fontWeight: 700 },
  /* Terms */
  termsSection: { marginTop: 24, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: "#d1d5db" },
  termsTitle: { fontSize: 10, fontWeight: 700, marginBottom: 6, color: BLUE },
  termItem: { fontSize: 8, color: GRAY, marginBottom: 3, lineHeight: 1.4 },
  /* Footer */
  footer: { position: "absolute" as const, bottom: 30, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: "#d1d5db", paddingTop: 8 },
  footerText: { fontSize: 7, color: GRAY },
});

/* ─── Terms ─── */
const TERMS = [
  "1. This quotation is valid for 30 days from the date of issue.",
  "2. A 50% deposit is required upon acceptance to secure scheduling.",
  "3. All equipment carries a 12-month warranty on parts and labour from date of installation.",
  "4. Installation will be completed within 5–10 business days of deposit confirmation, subject to stock availability.",
  "5. The customer is responsible for providing adequate electrical supply points as per unit specifications.",
  "6. This quote excludes any structural modifications, electrical upgrades, or building alterations unless explicitly stated.",
  "7. Payment terms: Net 30 days from invoice date. Late payments attract 2% monthly interest.",
  "8. A cancellation fee of 15% of the total quoted amount applies after acceptance.",
  "9. Prices are quoted in South African Rand (ZAR) and include VAT at 15% as shown.",
  "10. Any additional work not covered in this quotation will be quoted separately.",
];

/* ─── Document Component ─── */
export default function QuotePDFDocument({ data }: { data: QuotePDFData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.brandRow}>
            <View>
              <Text style={s.brandName}>0800-BE-COOL!</Text>
              <Text style={s.brandTagline}>AC Super Service — Professional HVAC Solutions</Text>
            </View>
            <View style={{ alignItems: "flex-end" as const }}>
              <Text style={{ fontSize: 14, fontWeight: 700, color: BLUE }}>QUOTATION</Text>
            </View>
          </View>
        </View>
        <View style={s.goldStripe} />

        {/* Quote meta + Client info */}
        <View style={s.metaRow}>
          <View style={s.metaBlock}>
            <Text style={s.metaLabel}>Prepared For</Text>
            <Text style={s.metaValue}>{data.clientName || "—"}</Text>
            {data.clientEmail && <Text style={{ fontSize: 8, color: GRAY }}>{data.clientEmail}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" as const }}>
            <Text style={s.metaLabel}>Quote #</Text>
            <Text style={s.metaValue}>{data.quoteNumber}</Text>
            <Text style={{ ...s.metaLabel, marginTop: 4 }}>Date</Text>
            <Text style={{ fontSize: 9 }}>{data.date}</Text>
            <Text style={{ ...s.metaLabel, marginTop: 4 }}>Valid Until</Text>
            <Text style={{ fontSize: 9 }}>{data.validUntil}</Text>
          </View>
        </View>

        {/* Table header */}
        <View style={s.tableHeader}>
          <Text style={{ ...s.thText, ...s.colDesc }}>Area / Description</Text>
          <Text style={{ ...s.thText, ...s.colQty }}>Qty</Text>
          <Text style={{ ...s.thText, ...s.colUnit }}>Unit Price</Text>
          <Text style={{ ...s.thText, ...s.colMarkup }}>Markup</Text>
          <Text style={{ ...s.thText, ...s.colTotal }}>Line Total</Text>
        </View>

        {/* Table rows */}
        {data.items.map((item, i) => (
          <React.Fragment key={i}>
            <View style={s.tableRow}>
              <View style={s.colDesc}>
                <Text style={s.tdText}>{item.areaName}</Text>
                <Text style={s.tdSub}>{item.unitName} · {item.btu.toLocaleString()} BTU</Text>
              </View>
              <Text style={{ ...s.tdText, ...s.colQty }}>{item.quantity}</Text>
              <Text style={{ ...s.tdText, ...s.colUnit }}>{formatZAR(item.unitPrice)}</Text>
              <Text style={{ ...s.tdText, ...s.colMarkup }}>{item.markupPercent}%</Text>
              <Text style={{ ...s.tdText, ...s.colTotal, fontWeight: 700 }}>{formatZAR(item.lineTotal)}</Text>
            </View>
            {/* Sub-items (materials, consumables from bundle) */}
            {item.subItems && item.subItems.length > 0 && item.subItems.map((sub, j) => (
              <View key={`${i}-sub-${j}`} style={s.subRow}>
                <Text style={{ ...s.subText, flex: 3 }}>
                  {"  ┗ "}{sub.name}{sub.pricingMode === "per-meter" ? " (per m)" : ""}
                </Text>
                <Text style={{ ...s.subText, flex: 0.8, textAlign: "center" as const }}>
                  {sub.pricingMode === "per-meter" ? `${sub.quantity}m` : `×${sub.quantity}`}
                </Text>
                <Text style={{ ...s.subText, flex: 1.2, textAlign: "right" as const }}>
                  {formatZAR(sub.unitPrice)}
                </Text>
                <Text style={{ ...s.subText, flex: 1, textAlign: "center" as const }}>—</Text>
                <Text style={{ ...s.subTextBold, flex: 1.2, textAlign: "right" as const }}>
                  {formatZAR(sub.lineTotal)}
                </Text>
              </View>
            ))}
          </React.Fragment>
        ))}

        {/* Totals */}
        <View style={s.totalsBox}>
          <View style={s.totalsRow}>
            <Text style={{ fontSize: 9, color: GRAY }}>Subtotal (excl. VAT)</Text>
            <Text style={{ fontSize: 9, fontWeight: 700 }}>{formatZAR(data.subtotal)}</Text>
          </View>
          <View style={s.totalsRow}>
            <Text style={{ fontSize: 9, color: GRAY }}>VAT ({(data.vatRate * 100).toFixed(0)}%)</Text>
            <Text style={{ fontSize: 9 }}>{formatZAR(data.vatAmount)}</Text>
          </View>
          <View style={s.totalsFinal}>
            <Text style={s.totalsFinalLabel}>Total Incl. VAT</Text>
            <Text style={s.totalsFinalValue}>{formatZAR(data.total)}</Text>
          </View>
        </View>

        {/* Terms and Conditions */}
        <View style={s.termsSection}>
          <Text style={s.termsTitle}>Terms & Conditions</Text>
          {TERMS.map((term, i) => (
            <Text key={i} style={s.termItem}>{term}</Text>
          ))}
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>0800-BE-COOL! AC Super Service</Text>
          <Text style={s.footerText}>info@0800becool.co.za · 0800 23 2665</Text>
          <Text style={s.footerText}>www.0800becool.co.za</Text>
        </View>
      </Page>
    </Document>
  );
}
