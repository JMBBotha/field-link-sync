import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

export interface GlanceLink {
  href: string;
  text: string;
}

export interface GlanceRow {
  id: string;
  label: string;
  detail?: string;
  amountText: string;
  href?: string;
  links?: GlanceLink[];
}

export interface GlanceModel {
  title: string;
  rule: string;
  rows: GlanceRow[];
  totalText: string;
  actionLabel: string;
  actionHref: string;
}

/** Dims the home and slides up. Same feel as the other admin-home how-counted sheet, written for this glance. */
export function AdminHomeGlanceSheet({ model, onClose }: { model: GlanceModel; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[80]" data-testid="how-counted-sheet" role="dialog" aria-modal="true" aria-label="How this was counted">
      <button type="button" aria-label="Dimmed home" className="absolute inset-0 bg-[#0F1B2A]/45" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white px-5 pb-6 pt-3 text-[#0F1B2A] shadow-[0_-6px_20px_rgba(0,0,0,.2)]">
        <div className="mx-auto mb-3 h-[5px] w-11 rounded-full bg-[#CBD5E1]" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">How this was counted</h2>
          <button type="button" data-testid="how-counted-close" onClick={onClose} className="rounded-lg border border-[#E3E8EF] px-2.5 py-1.5 text-[13px] font-bold">✕ Close</button>
        </div>
        <div className="mb-3 rounded-lg border-l-4 border-[#E8A06A] bg-[#FFF7ED] px-3 py-2.5 text-sm leading-relaxed">
          <b>{model.title}</b>
          <div>{model.rule}</div>
        </div>
        <ul>
          {model.rows.map((row) => (
            <li key={row.id} className="border-b border-[#E3E8EF] py-2.5 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1">
                  {row.links && row.links.length > 0 ? (
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {row.links.map((l) => (
                        <Link key={l.href + l.text} to={l.href} className="font-semibold text-[#1478C8] underline" onClick={onClose}>{l.text}</Link>
                      ))}
                    </span>
                  ) : row.href ? (
                    <Link to={row.href} className="font-semibold text-[#1478C8] underline" onClick={onClose}>{row.label}</Link>
                  ) : <span className="font-semibold">{row.label}</span>}
                  {row.links && row.links.length > 0 && <span className="mt-0.5 block">{row.label}</span>}
                  {row.detail && <span className="mt-0.5 block text-xs text-[#5B6B7F]">{row.detail}</span>}
                </span>
                <b className="shrink-0 tabular-nums">{row.amountText}</b>
              </div>
            </li>
          ))}
          {model.rows.length === 0 && <li className="py-2 text-sm text-[#5B6B7F]">Nothing in this figure.</li>}
          <li className="flex items-center justify-between py-2.5 text-sm font-extrabold">
            <span>Total</span>
            <span className="tabular-nums">{model.totalText}</span>
          </li>
        </ul>
        <Link
          to={model.actionHref}
          data-testid="how-counted-action"
          onClick={onClose}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-[10px] bg-[#C2410C] text-base font-bold text-white hover:bg-[#9A3412]"
        >
          {model.actionLabel}
        </Link>
      </div>
    </div>,
    document.body,
  );
}

export function InfoMark({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid="how-counted-info"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="ml-1 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold italic leading-none opacity-90"
    >
      i
    </button>
  );
}
