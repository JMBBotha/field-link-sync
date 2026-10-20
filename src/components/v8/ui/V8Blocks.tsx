/**
 * V8 standard look building blocks (Johan 20 Oct 14:04: client-page look across the whole app).
 * Appearance only: no data, no behaviour. Mirrors AdminCustomerDetailPage / LeadPageC.
 */
import type React from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type V8Tone = "neutral" | "info" | "success" | "warn" | "danger" | "brand" | "violet" | "pink" | "orange";

/** Chip colours, each with a readable dark-mode variant. */
export const V8_TONE: Record<V8Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-400/30",
  info: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30",
  success: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-400/30",
  warn: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30",
  danger: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30",
  brand: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-400/30",
  violet: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-400/30",
  pink: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-500/15 dark:text-pink-300 dark:border-pink-400/30",
  orange: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-400/30",
};

/** Chips that sit on the navy header card. */
export const V8_ON_NAVY_CHIP = "bg-white/15 text-white border-white/25";

export const V8_HEADER_CLASS = "rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white sm:p-5";
export const V8_CARD_CLASS = "rounded-2xl border bg-card text-card-foreground shadow-sm";

export function StatusChip({ tone = "neutral", className, children }: { tone?: V8Tone; className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap", V8_TONE[tone], className)}>{children}</span>;
}

export function PageHeaderCard({ eyebrow, title, subtitle, chips, actions, children, className }: {
  eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; chips?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <section className={cn(V8_HEADER_CLASS, className)} data-testid="v8-page-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">{eyebrow}</div>}
          <h1 className="truncate text-xl font-bold leading-tight sm:text-2xl">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-white/80">{subtitle}</div>}
          {chips && <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

export function ContentCard({ title, action, children, className, bodyClassName }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn(V8_CARD_CLASS, className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      <div className={cn("p-4", (title || action) && "pt-2", bodyClassName)}>{children}</div>
    </section>
  );
}

export function MoneyTile({ label, value, sub, tone = "default", onNavy = false, onClick }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "default" | "danger" | "warn" | "success"; onNavy?: boolean; onClick?: () => void;
}) {
  const valueTone = onNavy
    ? tone === "danger" ? "text-red-200" : tone === "warn" ? "text-amber-200" : "text-white"
    : tone === "danger" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "success" ? "text-green-600 dark:text-green-400" : "";
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cn("rounded-xl p-3 text-left", onNavy ? "bg-white/10" : "border bg-card", onClick && "transition hover:opacity-90")}>
      <div className={cn("text-[11px] font-medium uppercase tracking-wide", onNavy ? "text-white/70" : "text-muted-foreground")}>{label}</div>
      <div className={cn("mt-0.5 text-lg font-bold tabular-nums", valueTone)}>{value}</div>
      {sub && <div className={cn("text-[11px]", onNavy ? "text-white/70" : "text-muted-foreground")}>{sub}</div>}
    </Comp>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("v8-eyebrow mb-2", className)}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

/** The ONE primary next-step CTA per page (Johan 20 Oct 14:25): brand orange; red when overdue/urgent. Other buttons stay neutral. */
export const V8_CTA_CLASS = "bg-[#F7941D] hover:bg-[#e08310] text-white";
export const V8_CTA_URGENT_CLASS = "bg-[#DC2626] hover:bg-[#b91c1c] text-white";
export const nextStepClass = (tone: "default" | "urgent" = "default") => (tone === "urgent" ? V8_CTA_URGENT_CLASS : V8_CTA_CLASS);

export function NextStepButton({ tone = "default", className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "urgent" }) {
  return (
    <button type="button" data-testid="v8-next-step" data-tone={tone} {...rest}
      className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50", nextStepClass(tone), className)}>
      {children}
    </button>
  );
}
