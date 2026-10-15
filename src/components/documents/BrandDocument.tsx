import { withEoe } from "@/lib/eoeClause";
import type { ReactNode } from "react";
import logoLight from "@/assets/brand/logo-light.png";
import logoWhite from "@/assets/brand/logo-white.png";
import units from "@/assets/brand/units.png";
import { profileIdentity, type CompanyProfile } from "@/lib/companyProfiles";
import { formatRand } from "@/utils/formatRand";

/**
 * Light / Bold client document (Johan 2026-10-13, designs in brand-docs/Light + brand-docs/Bold).
 * One layout for quotes, the /quote client link and invoices, for EVERY company: the header,
 * footer, VAT and banking come from the document company's own record. Light is the default;
 * Bold is a per-company setting (company_profiles.document_style).
 * Labour is never its own line: callers pass lines with labour already folded in.
 */
export type DocumentStyle = "light" | "bold";

export const documentStyleOf = (p?: Partial<CompanyProfile> | null): DocumentStyle =>
  (p as any)?.document_style === "bold" ? "bold" : "light";

/** The 0800-BE-COOL artwork is Massair's own; other companies get their record's logo or none. */
export const isMassairProfile = (p?: Partial<CompanyProfile> | null) => !p?.legal_name || /massair/i.test(String(p.legal_name));

export interface BrandDocLine {
  key: string;
  quantity: string;
  code?: string | null;
  name: string;
  description?: string | null;
  rate: number;
  total: number;
  rateSuffix?: string;
}
export interface BrandDocSection { key: string; title?: string | null; lines: BrandDocLine[]; subtotal?: number | null }
export interface BrandDocCard { title: string; body: ReactNode }

export interface BrandDocumentProps {
  docType: "quote" | "invoice";
  title: string;
  number: string;
  profile?: Partial<CompanyProfile> | null;
  style?: DocumentStyle;
  partyLabel: string;
  partyName: string;
  partyLines: (string | null | undefined)[];
  partyVat?: string | null;
  meta: [string, string][];
  sections: BrandDocSection[];
  totals: { label: string; value: number; negative?: boolean }[];
  grandLabel: string;
  grandTotal: number;
  afterTotals?: ReactNode;
  cards: BrandDocCard[];
  terms?: string | null;
  /** Full terms & conditions page (quotes), rendered last on its own page. */
  fullTermsPage?: ReactNode;
  captureRoot: "estimate" | "invoice";
  /**
   * Invoice closing layout (Johan 14 Oct, AVEC La Terre invoices): the Payment / Banking /
   * Warranty block starts its own page, laid out full width; the Terms + logo/unit footer
   * travel together and are pinned to the bottom of the last page.
   */
  closingPage?: boolean;
  className?: string;
}

const money = (n: number) => {
  const v = Number(n) || 0;
  return formatRand(Object.is(v, -0) ? 0 : v);
};

const CSS = `
.bd{--b1:#0B4FA8;--b2:#1AA7EC;--or:#F7941D;--ink:#1d2a3a;--mut:#6b7a8c;--line:#e3eaf2;font-family:Montserrat,Arial,Helvetica,sans-serif;color:var(--ink);font-size:12.5px;background:#fff;container-type:inline-size;position:relative}
.bd *{box-sizing:border-box}.bd .pg{padding:42px 42px 0}
.bd .top{display:flex;justify-content:space-between;align-items:center;gap:18px}
.bd .hl{display:flex;align-items:center;gap:20px;min-width:0}
.bd .logo{height:110px;width:auto;display:block;object-fit:contain}
.bd .hco{font-size:10.5px;line-height:1.5;color:var(--b1);border-left:2px solid var(--b2);padding-left:16px}
.bd .hco b{font-size:13px}
.bd .ttl{text-align:right;flex-shrink:0}
.bd h1{margin:0;font-weight:800;letter-spacing:.06em;color:var(--b1);font-size:27px;line-height:1.1}
.bd .no{font-weight:600;margin-top:6px;color:var(--or)}
.bd .accent{height:3px;background:linear-gradient(90deg,var(--b2) 75%,var(--or) 75%);margin-top:16px}
.bd .parties{display:flex;justify-content:space-between;gap:20px;margin:22px 0 18px}
.bd h4{margin:0 0 6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--b2)}
.bd .tn{font-weight:700;font-size:14.5px;margin-bottom:2px}
.bd .to div{line-height:1.45}
.bd .meta{border-collapse:collapse}.bd .meta th{text-align:left;font-weight:500;color:var(--mut);padding:2px 18px 2px 0}.bd .meta td{font-weight:600}
.bd .room{margin-top:14px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--b1)}
.bd table.items{width:100%;border-collapse:collapse}
.bd .items th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:9px 8px;color:var(--b1);border-bottom:2px solid var(--b2)}
.bd .items td{padding:7px 8px;vertical-align:top;border-bottom:1px solid var(--line)}
.bd .items small{color:var(--mut);white-space:pre-line}
.bd .code{font-size:10.5px;color:#4b5a6c;white-space:nowrap}
.bd .r{text-align:right;white-space:nowrap}
.bd .sub td{border-bottom:0;font-weight:700;color:var(--b1)}
.bd .tot{margin:14px 0 0 auto;border-collapse:collapse;min-width:300px}.bd .tot td{padding:5px 8px}.bd .tot td+td{text-align:right}
.bd .tot .g td{font-weight:800;font-size:14.5px;color:#fff;background:var(--b2)}.bd .tot .g td:first-child{border-left:5px solid var(--or)}
.bd .notes{margin-top:18px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 22px;font-size:11px}
.bd .note h4{color:var(--or)}.bd .note p,.bd .note div{margin:0;line-height:1.45;color:#3a4859}
.bd .terms{margin-top:16px;border-top:1px solid var(--line);padding-top:10px;font-size:10px;line-height:1.45;color:#3a4859;white-space:pre-line}
.bd .sig{margin-top:22px;display:flex;align-items:center;gap:14px;font-size:9.5px;line-height:1.4;border-top:1px solid var(--line);padding:10px 42px 14px}
.bd .slogo{height:40px}.bd .sbar{width:2px;align-self:stretch;background:var(--b2)}.bd .stext{flex:1;color:var(--b1)}.bd .sn{font-weight:800}.bd .sunits{height:50px}
/* Page head: thin blue/orange starting rule + short company line, every page (Johan 14 Oct) */
.bd .phead{padding:14px 42px 0}.bd .prule{height:2px;background:linear-gradient(90deg,var(--b2) 75%,var(--or) 75%)}
.bd .pline{font-size:9px;letter-spacing:.02em;color:var(--mut);padding:0 0 4px}.bd .pline+.prule{margin-top:5px}
.bd.bold .phead{padding-bottom:8px}
/* Closing page */
.bd .closing{padding:6px 0 18px}
.bd .notes.wide{grid-template-columns:1fr 1fr;gap:14px 28px;font-size:11.5px;margin-top:0}
.bd .notes.wide .note.full{grid-column:1/-1}
.bd .notes.wide .note p,.bd .notes.wide .note div{line-height:1.55}
.bd .foot{margin-top:22px}.bd .foot .terms{margin:0 42px;padding-bottom:4px}
@media print{.bd .closing{break-before:page;page-break-before:always}.bd .foot{break-inside:avoid;page-break-inside:avoid}}
/* Bold */
.bd.bold .pg{padding-top:0}
.bd.bold .top{background:linear-gradient(120deg,#1AA7EC 55%,#1590D6);margin:0 -42px;padding:22px 42px 20px;color:#fff;align-items:flex-start}
.bd.bold .logo{height:86px}.bd.bold .hco{color:#fff;border-left:1.5px solid rgba(255,255,255,.6)}
.bd.bold h1{color:#fff}.bd.bold .no{color:#fff;background:var(--or);display:inline-block;padding:3px 12px;border-radius:6px}
.bd.bold .accent{height:0}.bd.bold h4{color:var(--b1)}
.bd.bold .items th{background:var(--b1);color:#fff;border-bottom:0}
.bd.bold .items tbody tr:nth-child(even) td{background:#f2f9fe}
.bd.bold .tot .g td{background:transparent;color:var(--b1);border-top:3px solid var(--or)}.bd.bold .tot .g td:first-child{border-left:0}
.bd.bold .note{background:#f2f9fe;border-left:3px solid var(--or);padding:9px 12px}
.bd.bold .sig{background:#f2f9fe;border-top:3px solid var(--b2)}
/* Phone (on-screen only; the PDF capture root is always 820px wide) */
@container (max-width: 620px){
 .bd{overflow-wrap:anywhere}.bd .r{white-space:normal}.bd .pg{padding:18px 14px 0}.bd .top{flex-direction:column;align-items:flex-start}.bd.bold .top{margin:0 -14px;padding:16px 14px}
 .bd .hl{flex-direction:column;align-items:flex-start;gap:10px}.bd .logo{height:70px}.bd .ttl{text-align:left}
 .bd .parties{flex-direction:column}.bd .items .c-code{display:none}.bd .items th,.bd .items td{padding:6px 4px}
 .bd .notes,.bd .notes.wide{grid-template-columns:1fr}.bd .foot .terms{margin:0 14px}.bd .phead{padding:10px 14px 0}.bd .tot{min-width:0;width:100%}.bd .sig{flex-wrap:wrap;padding:10px 14px}.bd .sunits{display:none}
}`;

/**
 * Notes printed line by line (Johan 14 Oct): the PDF capture (html2canvas) ignores
 * white-space:pre-line, which ran the warranty / terms-of-payment text together. Each line is
 * its own block and blank lines become paragraph gaps; the text itself is unchanged.
 */
export const NotesBody = ({ text, testId = "invoice-notes" }: { text: string; testId?: string }) => (
  <div data-testid={testId}>
    {text.split(/\n\s*\n/).map((para, i) => (
      <p key={i} style={{ margin: i ? "7px 0 0" : 0 }}>
        {para.split("\n").map((line, j) => <span key={j} style={{ display: "block" }}>{line}</span>)}
      </p>
    ))}
  </div>
);

export default function BrandDocument(p: BrandDocumentProps) {
  const style = p.style ?? documentStyleOf(p.profile);
  // Client documents all use the closing-page layout (Johan 14 Oct); pass closingPage={false} to opt out.
  const closing = p.closingPage ?? true;
  const id = profileIdentity(p.profile);
  const massair = isMassairProfile(p.profile);
  const headLine = [id.legalName, id.vatNo && `VAT ${id.vatNo}`, id.tel && `Tel ${id.tel}`, id.email].filter(Boolean).join("  ·  ");
  const recordLogo = (p.profile as any)?.logo_url as string | undefined;
  // Bold (blue header): Massair always uses the transparent logo, never a boxed upload (Johan 13 Oct 12:52).
  const logo = massair && style === "bold" ? logoWhite : recordLogo || (massair ? (style === "bold" ? logoWhite : logoLight) : null);
  const addr = id.addressLines.join(", ");
  const hasCode = p.sections.some((s) => s.lines.some((l) => l.code));
  return (
    <div data-pdf-capture-root={p.captureRoot} data-doc-style={style} data-testid="brand-document" className={`bd ${style} pdf-page mx-auto w-full ${p.className || ""}`}>
      <style>{CSS}</style>
      {closing && (
        <>
          {/* Page 1: company line only. Pages 2+: company line above the thin blue/orange rule (Johan 14 Oct 07:53). */}
          <div className="phead" data-pdf-page-head-first data-testid="doc-page-head-first">
            <div className="pline">{headLine}</div>
          </div>
          <div className="phead" data-pdf-page-head data-testid="doc-page-head" style={{ display: "none" }}>
            <div className="pline">{headLine}</div>
            <div className="prule" />
          </div>
        </>
      )}
      <div className="pg">
        <div className="top">
          <div className="hl">
            {logo && <img className="logo" src={logo} alt={`${id.legalName} logo`} />}
            <div className="hco" data-testid="company-block" data-company-source={id.fromRecord ? "record" : "fallback"}>
              <b>{id.legalName}</b>
              {id.addressLines.map((l) => <div key={l}>{l}</div>)}
              {id.tel && <div>Tel {id.tel}</div>}
              {id.whatsapp && <div>WhatsApp {id.whatsapp}</div>}
              {id.email && <div>{id.email}</div>}
              {id.web && <div>{id.web}</div>}
              {id.vatNo && <div>VAT {id.vatNo}</div>}
            </div>
          </div>
          <div className="ttl"><h1>{p.title}</h1><div className="no">{p.number}</div></div>
        </div>
        <div className="accent" />
        <div className="parties">
          <div className="to">
            <h4>{p.partyLabel}</h4>
            <div className="tn">{p.partyName}</div>
            {p.partyLines.filter((l) => l && String(l).trim()).map((l, i) => <div key={i}>{l}</div>)}
            {p.partyVat && p.partyVat.trim() && <div data-testid={p.docType === "invoice" ? "billed-to-vat" : "customer-vat"}>VAT No {p.partyVat.trim()}</div>}
          </div>
          <table className="meta"><tbody>{p.meta.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
        </div>

        <table className="items" data-testid="doc-lines">
          <thead><tr><th>Qty</th>{hasCode && <th className="c-code">Code</th>}<th>Description</th><th className="r">Rate excl VAT</th><th className="r">Total excl VAT</th></tr></thead>
          {p.sections.map((s) => (
            <tbody key={s.key}>
              {s.title && <tr><td colSpan={hasCode ? 5 : 4} className="room" style={{ borderBottom: 0, paddingTop: 14 }}>{s.title}</td></tr>}
              {s.lines.map((l) => (
                <tr key={l.key} data-testid="doc-line">
                  <td>{l.quantity}</td>
                  {hasCode && <td className="code c-code">{l.code || ""}</td>}
                  <td><b>{l.name}</b>{l.description ? <><br /><small>{l.description}</small></> : null}</td>
                  <td className="r">{money(l.rate)}{l.rateSuffix || ""}</td>
                  <td className="r" data-testid="doc-line-total">{money(l.total)}</td>
                </tr>
              ))}
              {s.subtotal != null && p.sections.length > 1 && (
                <tr className="sub"><td colSpan={hasCode ? 4 : 3} className="r">{s.title ? `${s.title} subtotal` : "Subtotal"}</td><td className="r">{money(s.subtotal)}</td></tr>
              )}
            </tbody>
          ))}
          {p.sections.length === 0 && <tbody><tr><td colSpan={5} style={{ textAlign: "center", color: "#94a3b8" }}>No line items</td></tr></tbody>}
        </table>

        <table className="tot" data-pdf-keep data-testid="estimate-totals"><tbody>
          {p.totals.map((t) => <tr key={t.label}><td>{t.label}</td><td>{t.negative ? "-" : ""}{money(t.value)}</td></tr>)}
          <tr className="g"><td>{p.grandLabel}</td><td>{money(p.grandTotal)}</td></tr>
        </tbody></table>
        {p.afterTotals}

        {!closing && p.cards.length > 0 && (
          <div className="notes">{p.cards.map((c) => <div className="note" key={c.title}><h4>{c.title}</h4><div>{c.body}</div></div>)}</div>
        )}
        {!closing && <div className="terms" data-testid="doc-terms"><h4>Terms</h4><NotesBody testId="doc-terms-text" text={withEoe(p.terms, id.legalName, p.docType)} /></div>}
        {!closing && p.fullTermsPage}
        {closing && p.cards.length > 0 && (
          <div className="closing" data-pdf-break-before data-testid="doc-closing">
            <div className="notes wide">{p.cards.map((c, i) => <div className={`note${p.cards.length % 2 === 1 && i === p.cards.length - 1 ? " full" : ""}`} key={c.title}><h4>{c.title}</h4><div>{c.body}</div></div>)}</div>
            {p.fullTermsPage && <div className="terms" data-testid="doc-terms"><NotesBody testId="doc-terms-text" text={withEoe(p.terms, id.legalName, p.docType)} /></div>}
          </div>
        )}
        {closing && p.fullTermsPage}
      </div>
      {closing && !p.fullTermsPage ? (
        <div className="foot" data-pdf-bottom data-testid="doc-foot">
          <div className="terms" data-testid="doc-terms"><h4>Terms</h4><NotesBody testId="doc-terms-text" text={withEoe(p.terms, id.legalName, p.docType)} /></div>
        </div>
      ) : null}
      {closing ? (
        <div className="sig" data-pdf-every-page data-testid="doc-signature">
          {logo && <img className="slogo" src={massair && !recordLogo ? logoLight : logo} alt="" />}
          <div className="sbar" />
          <div className="stext">
            <div className="sn">{id.legalName}</div>
            <div>{[id.tel && `Tel ${id.tel}`, id.whatsapp && `WhatsApp ${id.whatsapp}`].filter(Boolean).join("  |  ")}</div>
            <div>{[id.email, id.web].filter(Boolean).join("  |  ")}</div>
            <div>{[addr, id.vatNo && `VAT ${id.vatNo}`].filter(Boolean).join("  |  ")}</div>
          </div>
          {massair && <img className="sunits" src={units} alt="" />}
        </div>
      ) : (
        <div className="sig" data-pdf-bottom data-testid="doc-signature">
          {logo && <img className="slogo" src={massair && !recordLogo ? logoLight : logo} alt="" />}
          <div className="sbar" />
          <div className="stext">
            <div className="sn">{id.legalName}</div>
            <div>{[id.tel && `Tel ${id.tel}`, id.whatsapp && `WhatsApp ${id.whatsapp}`].filter(Boolean).join("  |  ")}</div>
            <div>{[id.email, id.web].filter(Boolean).join("  |  ")}</div>
            <div>{[addr, id.vatNo && `VAT ${id.vatNo}`].filter(Boolean).join("  |  ")}</div>
          </div>
          {massair && <img className="sunits" src={units} alt="" />}
        </div>
      )}
    </div>
  );
}
