import { useDocumentCompanyProfile } from "@/hooks/useDocumentCompanyProfile";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import qrcode from "@/vendor/qrcodeGenerator";
import { unitBrochureUrl } from "@/lib/unitBrochure";
import { sameOriginAsset } from "@/lib/captureImages";
import {
  buildUnitCards, missingModelKeys, specChips, unitLineModelKey,
  type FeatureHighlight, type ProductMedia, type UnitCard, type UnitCardLine,
} from "@/lib/unitCards";

/**
 * "The units in this quote" (Johan 13 Oct 08:32): one card per quoted model, printed after
 * the totals and before the terms on the client link and the PDF (same DOM is captured).
 * Approved product_media only; anything else shows the fallback (brand + outline + catalogue data).
 */

export type DocVariant = "light" | "bold";

const BLUE = "#0B4FA8", SKY = "#1AA7EC", ORANGE = "#F7941D", INK = "#1d2a3a", MUTED = "#6b7a8c";
/** Johan 15 Oct 18:01: Bold's card fills were too heavy — this lighter blue carries the white text. */
const BLUE_SOFT = "#2673C8";


function qrSvgDataUrl(url: string): string | null {
  try {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    // Raster QR avoids incomplete SVG path capture; retain a four-module quiet zone.
    if (typeof document === "undefined") return qr.createDataURL(3, 12);
    const canvas = document.createElement("canvas");
    const size = qr.getModuleCount();
    canvas.width = canvas.height = (size + 8) * 3;
    const ctx = canvas.getContext("2d");
    if (!ctx) return qr.createDataURL(3, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (qr.isDark(y, x)) ctx.fillRect((x + 4) * 3, (y + 4) * 3, 3, 3);
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

const ICONS: Record<string, string> = {
  windfree: "M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7",
  ai: "M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 7h10v10H7zM10 10h4v4h-4z",
  fast: "M13 2 4 14h7l-1 8 9-12h-7z",
  protect: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z M9 12l2 2 4-4",
  inverter: "M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0",
  filter: "M4 5h16l-6 7v6l-4 2v-8z",
  wifi: "M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
  quiet: "M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6",
};

function Icon({ name, color, size = 22 }: { name?: string | null; color: string; size?: number }) {
  const d = ICONS[String(name || "").toLowerCase()] || ICONS.inverter;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Neutral placeholder until a real product photo is approved (Johan 26 Oct): no drawn unit, never a fake picture. */
function PhotoPlaceholder({ modelCode, bold }: { modelCode?: string | null; bold: boolean }) {
  const c = bold ? "#fff" : "#7b8fa6";
  return (
    <div data-testid="unit-card-photo-placeholder" style={{ textAlign: "center", color: c }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
      </svg>
      <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>Photo to follow</div>
      {modelCode && <div style={{ fontSize: 10, marginTop: 2, opacity: 0.85 }}>{modelCode}</div>}
    </div>
  );
}

function Highlight({ h, variant }: { h: FeatureHighlight; variant: DocVariant }) {
  const bold = variant === "bold";
  return (
    <div data-testid="unit-card-highlight" style={{
      display: "flex", alignItems: "center", gap: 10, marginTop: 8, padding: "6px 10px", borderRadius: 6,
      background: bold ? BLUE_SOFT : "#fff4e6", borderLeft: `4px solid ${ORANGE}`,
    }}>
      {h.image_url
        ? <img src={sameOriginAsset(h.image_url) ?? undefined} alt="" crossOrigin="anonymous" style={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0 }} />
        : <span style={{ flexShrink: 0, display: "inline-flex", width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", background: bold ? "rgba(255,255,255,.12)" : "#fff" }}>
            <Icon name={h.icon} color={bold ? "#fff" : ORANGE} size={18} />
          </span>}
      <div style={{ fontSize: 11, lineHeight: 1.35, color: bold ? "#fff" : INK }}>
        <b style={{ color: bold ? "#ffd29a" : ORANGE }}>{h.title}</b> · {h.text}
      </div>
    </div>
  );
}

function Card({ card, variant, companyId }: { card: UnitCard; variant: DocVariant; companyId?: string | null }) {
  const m = card.media;
  const bold = variant === "bold";
  // No outside links (Johan 13 Oct 10:57): product_url/support_url stay in the DB, never rendered.
  // QR + model link open OUR brochure page, branded for the quote's company (Johan 13 Oct 11:42).
  // Only models with approved content get a brochure (Johan 13 Oct 11:53): no QR / button / link otherwise.
  const approved = m?.status === "approved";
  const link = approved ? unitBrochureUrl(card.modelKey, companyId) : null;
  const qr = useMemo(() => (link ? qrSvgDataUrl(link) : null), [link]);
  const chips = specChips(m?.specs, { btu: card.btu, refrigerant: card.refrigerant });
  const img = m && m.image_status === "ready" && m.image_url ? m.image_url : null;
  const where = card.rooms.length ? `${card.rooms.join(", ")} ×${card.quantity}` : `×${card.quantity}`;
  return (
    <div data-pdf-keep data-testid="unit-card" data-model={card.modelKey} className="uc" style={{
      display: "grid", gridTemplateColumns: qr ? "150px 1fr 84px" : "150px 1fr", gap: 16, padding: 14, marginBottom: 12,
      borderRadius: 8, breakInside: "avoid", pageBreakInside: "avoid",
      border: bold ? "none" : "1px solid #e3eaf2", borderTop: bold ? "none" : `3px solid ${SKY}`,
      borderLeft: bold ? `6px solid ${ORANGE}` : undefined,
      background: bold ? "#eef3f9" : "#fff",
    }}>
      <div className="uc-img" style={{
        borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120,
        background: bold ? `linear-gradient(160deg, ${BLUE_SOFT}, ${SKY})` : "linear-gradient(160deg,#eaf6fd,#f7fbff)",
      }}>
        {img
          ? <img src={sameOriginAsset(img) ?? undefined} alt={card.modelCode} crossOrigin="anonymous" style={{ maxWidth: 138, maxHeight: 108, objectFit: "contain", filter: "drop-shadow(0 6px 8px rgba(11,79,168,.22))" }} />
          : <PhotoPlaceholder modelCode={card.modelCode} bold={bold} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 800, color: BLUE, fontSize: 14, lineHeight: 1.2 }}>{m?.display_name || card.name}</div>
            <div style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>
              {m?.subtitle ? `${m.subtitle} · ` : ""}<span style={{ color: ORANGE, fontWeight: 600 }}>{where}</span>
            </div>
          </div>
          {link ? <a data-pdf-link data-testid="unit-card-model" href={link} target="_blank" rel="noopener" style={{ fontSize: 10, fontWeight: 700, color: bold ? "#fff" : SKY, background: bold ? SKY : "transparent", textDecoration: "none", border: `1px solid ${SKY}`, borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>{card.modelCode} ↗</a> : <span data-testid="unit-card-model" style={{ fontSize: 10, fontWeight: 700, color: MUTED, border: "1px solid #c8d5e2", borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>{card.modelCode}</span>}
        </div>
        {m?.bullets && m.bullets.length > 0 && (
          <ul style={{ margin: "6px 0", paddingLeft: 16, fontSize: 11, lineHeight: 1.4, color: "#3a4859" }}>
            {m.bullets.slice(0, 5).map((b, i) => <li key={i} style={{ marginBottom: 1 }}>{b}</li>)}
          </ul>
        )}
        {m?.feature_highlight?.title && <Highlight h={m.feature_highlight} variant={variant} />}
        {chips.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {chips.map((c) => (
              <span key={c} style={{ display: "inline-block", background: bold ? BLUE_SOFT : "#eaf6fd", color: bold ? "#fff" : BLUE, fontSize: 10, fontWeight: 600, borderRadius: 10, padding: "2px 8px", margin: "0 5px 5px 0" }}>{c}</span>
            ))}
          </div>
        )}
      </div>
      {qr && link && (
        <div className="uc-qr" style={{ textAlign: "center" }}>
          <a data-pdf-link href={link} target="_blank" rel="noopener" aria-label={`Brochure for ${card.modelCode}`} style={{ display: "inline-block" }}><img data-testid="unit-card-qr" src={qr} alt={`QR code for ${card.modelCode}`} style={{ width: 76, height: 76 }} /></a>
          <div style={{ fontSize: 8.5, color: MUTED, lineHeight: 1.3 }}>Scan for the brochure</div>
          <a data-pdf-link data-testid="unit-card-brochure-btn" href={link} target="_blank" rel="noopener" style={{ display: "inline-block", marginTop: 6, background: bold ? ORANGE : SKY, color: "#fff", fontSize: 10, fontWeight: 700, textDecoration: "none", borderRadius: 5, padding: "4px 8px", whiteSpace: "nowrap" }}>View brochure</a>
        </div>
      )}
    </div>
  );
}

export function QuoteUnitCardsView({ cards, variant = "light", companyId = null, companyName = null }: { cards: UnitCard[]; variant?: DocVariant; companyId?: string | null; /** Quote company's display name (trading, else legal) from its own record. */ companyName?: string | null }) {
  // Each company its own name (Johan 16 Oct 10:23): explicit prop, else the quote company's record. Never "t/a".
  const rec = useDocumentCompanyProfile(companyId, null, !companyName && !!companyId);
  const coName = String(companyName || (rec as any)?.trading_name || rec?.legal_name || "").split(/\s+t\/a\s+/i)[0].trim();
  if (!cards.length) return null;
  const sources = [...new Set(cards.map((c) => c.media?.brand).filter(Boolean))];
  return (
    <section data-testid="quote-unit-cards" style={{ marginTop: 28, breakBefore: "auto" }}>
      {/* Phones (container <=620px; the PDF capture root is 820px so the PDF keeps QR + 150px image): fixed 96px thumbnail, no QR. */}
      <style>{`@container (max-width: 620px){[data-testid=quote-unit-cards] .uc{grid-template-columns:96px 1fr!important;gap:10px!important;padding:10px!important;align-items:start}
[data-testid=quote-unit-cards] .uc-img{width:96px;height:96px;min-height:0!important;overflow:hidden}
[data-testid=quote-unit-cards] .uc-img img{max-width:88px!important;max-height:88px!important}
[data-testid=quote-unit-cards] .uc-img svg{width:86px;height:auto}
[data-testid=quote-unit-cards] .uc-qr{display:none!important}}`}</style>
      <div style={{ borderLeft: `4px solid ${ORANGE}`, paddingLeft: 10, marginBottom: 4, fontSize: 17, fontWeight: 800, color: BLUE }}>
        The units in this quote
        <span style={{ fontSize: 11, fontWeight: 500, color: MUTED, marginLeft: 10 }}>
          {cards.length} model{cards.length === 1 ? "" : "s"} · tap a model number or scan for its brochure
        </span>
      </div>
      <p style={{ color: MUTED, fontSize: 11, margin: "0 0 10px 14px" }}>Every unit is supplied and installed by {coName || "us"} with our workmanship guarantee.</p>
      {cards.map((c) => <Card key={c.modelKey} card={c} variant={variant} companyId={companyId} />)}
      <p style={{ fontSize: 9, color: "#4b5563", marginTop: 4 }}>
        Product images are illustrative{sources.length ? ` (© ${sources.join(", ")})` : ""}; specifications are as published by the manufacturer and may change. The model numbers quoted are binding.
      </p>
    </section>
  );
}

/** Loads approved content for the quote's models. With `ensure` (staff only) uncached models are fetched in the background into DRAFT. */
export function useQuoteUnitCards(lines: UnitCardLine[] | null | undefined, opts: { ensure?: boolean; enabled?: boolean } = {}) {
  const { ensure = false, enabled = true } = opts;
  const [media, setMedia] = useState<Map<string, ProductMedia>>(new Map());
  const keys = useMemo(() => [...new Set((lines || []).map(unitLineModelKey).filter((k): k is string => !!k))].sort(), [lines]);
  const sig = keys.join("|");
  useEffect(() => {
    if (!enabled || !keys.length) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase.from("product_media" as never) as any).select("*").in("model_key", keys);
        if (cancelled) return;
        const map = new Map<string, ProductMedia>(((data || []) as ProductMedia[]).map((r) => [r.model_key, r]));
        setMedia(map);
        if (ensure) {
          // Staff-only RLS: drafts are visible to Massair admins; for others only approved rows come back,
          // so the server de-dupes again before fetching. Never awaited, never blocks quoting.
          const missing = missingModelKeys(lines || [], map.keys());
          if (missing.length) {
            await ensureUnitContent(missing);
            const { data: refreshed } = await (supabase.from("product_media" as never) as any).select("*").in("model_key", keys);
            if (!cancelled) setMedia(new Map<string, ProductMedia>(((refreshed || []) as ProductMedia[]).map((r) => [r.model_key, r])));
          }
        }
      } catch { /* cards are optional */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ensure, enabled]);
  const cards = useMemo(() => (enabled ? buildUnitCards(lines || [], media) : []), [lines, media, enabled]);
  return { cards, media };
}

const inFlight = new Set<string>();
/** Fire-and-forget: ask the edge function to fetch + cut out + save DRAFT content for these models. */
export async function ensureUnitContent(modelKeys: string[]): Promise<void> {
  const todo = modelKeys.filter((k) => !inFlight.has(k));
  if (!todo.length) return;
  todo.forEach((k) => inFlight.add(k));
  try {
    await supabase.functions.invoke("lookup-ac-unit-specs", { body: { action: "ensure_media", model_codes: todo } });
  } catch { /* ignore: fallback card shows */ }
}

/** Convenience wrapper: section with data loading. */
export default function QuoteUnitCards({ lines, variant = "light", ensure = false, enabled = true }: { lines: UnitCardLine[] | null | undefined; variant?: DocVariant; ensure?: boolean; enabled?: boolean }) {
  const { cards } = useQuoteUnitCards(lines, { ensure, enabled });
  return <QuoteUnitCardsView cards={cards} variant={variant} />;
}
