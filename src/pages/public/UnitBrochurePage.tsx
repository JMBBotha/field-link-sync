import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import logoLight from "@/assets/brand/logo-light.png";
import logoWhite from "@/assets/brand/logo-white.png";
import { brochureSpecRows, brochureDimensionRows, type BrochureCompany } from "@/lib/unitBrochure";
import { Button } from "@/components/ui/button";
import type { ProductMedia } from "@/lib/unitCards";

/**
 * Public unit brochure /u/:modelKey?c=companyId (Johan 13 Oct 11:42).
 * Approved product_media only (via public_unit_brochure, SECURITY DEFINER), sender company's branding,
 * Light/Bold per the company's document_style, no outside links, no prices, E&OE footer, printable to A4 PDF.
 */
export interface BrochureData { state: "approved" | "not_approved" | "not_found"; model_code: string; brand?: string | null; media: ProductMedia | null; company: BrochureCompany | null }

const MASSAIR_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";

const CSS = `
.ub{--b1:#0B4FA8;--b2:#1AA7EC;--or:#F7941D;--ink:#1d2a3a;--mu:#6b7a8c;font-family:Montserrat,Arial,sans-serif;color:var(--ink);background:#fff;min-height:100vh}
.ub *{box-sizing:border-box}.ub .w{max-width:794px;margin:0 auto;padding:18px 28px 28px}
.ub .hd{display:flex;justify-content:space-between;align-items:center;gap:12px}.ub .hd img{height:64px;width:auto;object-fit:contain}
.ub .cn{font-weight:800;color:var(--b1);font-size:18px}.ub .r{text-align:right}.ub .k{font-size:22px;font-weight:800;color:var(--b1)}.ub .s{color:var(--or);font-weight:700;font-size:12px}
.ub .bar{height:3px;margin:12px 0 0;background:linear-gradient(90deg,var(--b2) 75%,var(--or) 75%)}
.ub .hero{display:grid;grid-template-columns:1.1fr 1fr;gap:20px;margin-top:20px;align-items:center}
.ub .tile{border-radius:10px;background:linear-gradient(160deg,#eaf6fd,#f7fbff);min-height:220px;display:flex;align-items:center;justify-content:center;border-top:3px solid var(--b2)}
.ub .tile img{max-width:90%;max-height:200px;object-fit:contain;filter:drop-shadow(0 10px 12px rgba(11,79,168,.22))}
.ub .eb{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--b2);text-transform:uppercase}
.ub h1{font-size:26px;line-height:1.15;color:var(--b1);margin:4px 0 6px}.ub .sub{color:var(--mu);font-size:12px}
.ub .chip{display:inline-block;font-size:10px;font-weight:700;color:var(--b2);border:1px solid var(--b2);border-radius:5px;padding:2px 7px;margin-top:8px}
.ub h2{border-left:4px solid var(--or);padding-left:10px;font-size:16px;color:var(--b1);margin:24px 0 10px}
.ub .hl{padding:10px 12px;border-radius:6px;background:#fff4e6;border-left:4px solid var(--or);font-size:12px;line-height:1.4}.ub .hl b{color:var(--or)}
.ub .feat{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.ub .f{border:1px solid #e3eaf2;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.4}
.ub table{width:100%;border-collapse:collapse;font-size:12px}.ub td{padding:6px 10px;border-bottom:1px solid #eef2f6}.ub td:first-child{color:var(--ink);width:45%}.ub td:last-child{font-weight:600}.ub tr:nth-child(odd) td{background:#f7fbff}.ub tr{break-inside:avoid}.ub h2{break-after:avoid}.ub .hero,.ub .f,.ub .hl,.ub .ft{break-inside:avoid}
.ub .ft{margin-top:24px;background:var(--b2);color:#fff;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;gap:12px;font-size:12px;border-left:6px solid var(--or)}
.ub .ft .n{font-weight:800;font-size:14px}.ub .note{color:#9aa7b5;font-size:9.5px;margin-top:10px}
.ub .pb{margin-top:14px;text-align:center}.ub .pb button{background:var(--b1);color:#fff;border:0;border-radius:6px;padding:9px 18px;font-weight:700;font-size:13px;cursor:pointer}
.ub .msg{margin:40px 0;text-align:center;color:var(--mu);font-size:14px;line-height:1.5}.ub .msg b{display:block;color:var(--b1);font-size:20px;margin-bottom:6px}
.ub.bold .hdw{background:var(--b1);color:#fff}.ub.bold .hdw .w{padding-bottom:16px}.ub.bold .hdw .k,.ub.bold .hdw .cn{color:#fff}.ub.bold .bar{display:none}
.ub.bold .tile{background:linear-gradient(160deg,var(--b1),var(--b2));border-top:0}.ub.bold .hl{background:var(--b1);color:#fff}.ub.bold .hl b{color:#ffd29a}
.ub.bold .f{background:#eef3f9;border:0;border-left:4px solid var(--or)}.ub.bold .ft{background:var(--b1)}
@media (max-width:500px){.ub .w{padding:14px 16px 22px}.ub .hd img{height:48px}.ub .k{font-size:15px}.ub .hero{grid-template-columns:1fr}.ub .tile{min-height:170px}.ub h1{font-size:23px}.ub .feat{grid-template-columns:1fr}.ub .ft{flex-direction:column}.ub .ft .r{text-align:left}}
.ub.pdf .w{padding:12px 24px 10px}.ub.pdf .hero{margin-top:12px}.ub.pdf .tile{min-height:170px}.ub.pdf .tile img{max-height:160px}.ub.pdf h2{margin:14px 0 8px}.ub.pdf td{padding:4px 10px}.ub.pdf .f{padding:7px 10px}.ub.pdf .ft{margin-top:14px}.ub.pdf .pb{display:none}.ub.pdf{min-height:0}
@media print{@page{size:A4;margin:0}.ub .pb{display:none}.ub .w{padding:12px 24px 10px}.ub .hero{margin-top:12px}.ub .tile{min-height:170px}.ub .tile img{max-height:160px}.ub h2{margin:14px 0 8px}.ub td{padding:4px 10px}.ub .f{padding:7px 10px}.ub .ft{margin-top:14px}.ub{min-height:0}.ub *{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

function splitBullet(b: string): [string | null, string] {
  const i = b.indexOf(":");
  return i > 2 && i < 40 ? [b.slice(0, i), b.slice(i + 1).trim()] : [null, b];
}

/** `pdf`: compact A4 layout without the print button, used for pages appended to the quote PDF. */
export function UnitBrochureView({ data, pdf = false }: { data: BrochureData; pdf?: boolean }) {
  const co = data.company;
  const style = co?.document_style === "bold" ? "bold" : "light";
  const massair = co?.company_id === MASSAIR_ID;
  // Bold (blue header): Massair always uses the transparent logo (Johan 13 Oct 12:52).
  const logo = massair && style === "bold" ? logoWhite : co?.logo_url || (massair ? (style === "bold" ? logoWhite : logoLight) : null);
  const coName = co?.name || co?.legal_name || null;
  const m = data.media;
  const dimensions = brochureDimensionRows(m?.specs);
  const legal = co?.legal_name || coName;
  const header = (
    <div className="hdw"><div className="w" style={{ paddingBottom: style === "bold" ? 16 : 0 }}>
      <div className="hd">
        {logo ? <img src={logo} alt={`${coName || "Company"} logo`} /> : <div className="cn">{coName || ""}</div>}
        <div className="r"><div className="k">UNIT BROCHURE</div><div className="s">{[m?.brand || data.brand, data.model_code].filter(Boolean).join(" · ")}</div></div>
      </div>
      <div className="bar" />
    </div></div>
  );
  const contacts = co && (co.phone || co.email || co.website) ? (
    <div className="r" style={{ textAlign: "right" }}>{[co.phone, co.email, co.website].filter(Boolean).map((x) => <div key={x as string}>{x}</div>)}</div>
  ) : null;
  const footer = (
    <div className="ft" data-testid="brochure-footer">
      <div><div className="n">{coName ? `Supplied and installed by ${coName}` : "Supplied and installed by your installer"}</div>Workmanship guarantee · sizing advice · ask us for a quote</div>
      {contacts}
    </div>
  );
  const eoe = `Product image is illustrative${m?.brand ? ` (© ${m.brand})` : ""}. Specifications are as published by the manufacturer and may change. While every effort is made to ensure accuracy, this brochure is subject to errors and omissions (E&OE)${legal ? `; ${legal} reserves the right to correct any specification or typographical errors` : ""}. Prices are on your quotation only.`;

  return (
    <div className={`ub ${style}${pdf ? " pdf" : ""}`} data-paper data-testid="unit-brochure" data-state={data.state}>
      <style>{CSS}</style>
      {header}
      <div className="w" style={{ paddingTop: 0 }}>
        {!m ? (
          <>
            <div className="msg" data-testid="brochure-fallback"><b>{data.model_code || "Unit brochure"}</b>
              {data.state === "not_found" ? "We don't have a brochure for this model yet." : "The brochure for this unit is being prepared."}<br />
              {coName ? `Please contact ${coName} for the full details.` : "Please contact your installer for the full details."}</div>
            {footer}
          </>
        ) : (
          <>
            <div className="hero">
              <div className="tile">{m.image_url ? <img src={m.image_url} alt={m.model_code} /> : <span className="sub">{m.brand}</span>}</div>
              <div>
                <div className="eb">{[m.brand, m.family].filter(Boolean).join(" ")} · Wall split</div>
                <h1>{m.display_name || m.model_code}</h1>
                {m.subtitle && <div className="sub">{m.subtitle}</div>}
                <span className="chip">{m.model_code}</span>
              </div>
            </div>
            {(m.feature_highlight?.title || (m.bullets || []).length > 0) && <h2>Why this unit</h2>}
            {m.feature_highlight?.title && <div className="hl"><b>{m.feature_highlight.title}</b> · {m.feature_highlight.text}</div>}
            {(m.bullets || []).length > 0 && (
              <div className="feat">{(m.bullets || []).map((b, i) => { const [t, x] = splitBullet(b); return <div className="f" key={i}>{t && <b style={{ display: "block", color: "var(--b1)" }}>{t}</b>}{x}</div>; })}</div>
            )}
            <h2>Specifications</h2>
            <table><tbody>{brochureSpecRows(m.specs, m.model_code).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
            {dimensions.length > 0 && <section data-testid="brochure-dimensions">
              <h2>Unit dimensions &amp; weight</h2>
              <table><tbody>{dimensions.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
            </section>}
            {footer}
          </>
        )}
        <div className="note">{eoe}</div>
        <div className="pb"><Button type="button" onClick={() => window.print()}>Print / save as PDF</Button></div>
      </div>
    </div>
  );
}

export default function UnitBrochurePage() {
  const { modelKey = "" } = useParams();
  const [sp] = useSearchParams();
  const c = sp.get("c");
  const companyId = c && /^[0-9a-f-]{36}$/i.test(c) ? c : null;
  const [data, setData] = useState<BrochureData | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      const { data: d } = await (supabase.rpc as any)("public_unit_brochure", { p_model: modelKey, p_company: companyId });
      if (!off) setData((d as BrochureData) || { state: "not_found", model_code: modelKey.toUpperCase(), media: null, company: null });
    })().catch(() => !off && setData({ state: "not_found", model_code: modelKey.toUpperCase(), media: null, company: null }));
    return () => { off = true; };
  }, [modelKey, companyId]);
  useEffect(() => { if (data) document.title = `${data.media?.display_name || data.model_code} · ${data.company?.name || "Unit brochure"}`; }, [data]);
  if (!data) return <div style={{ padding: 40, textAlign: "center", fontFamily: "Arial", color: "#6b7a8c" }}>Loading…</div>;
  return <UnitBrochureView data={data} />;
}
