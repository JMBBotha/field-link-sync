import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { InfoMark } from "@/components/v8/AdminHomeFigures";
import type { CashSlice } from "@/lib/roleHome";
import { ADMIN_HOME_ROUTES } from "@/lib/roleHome";
import "./roleHome.css";

const BLUE = "#3D9BEB";

function mix(t: number): string {
  const a = [0x3d, 0x9b, 0xeb];
  const b = [0xff, 0xc2, 0x33];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Rounded-rect path, inset so a 2px stroke sits on the card edge. Starts top-left, counterclockwise. */
function edgePath(w: number, h: number, radius: number): string {
  const inset = 1.15;
  const x = inset;
  const y = inset;
  const rw = Math.max(2, w - inset * 2);
  const rh = Math.max(2, h - inset * 2);
  const r = Math.max(0, Math.min(radius, rw / 2, rh / 2));
  return [
    `M ${x + r} ${y}`,
    `A ${r} ${r} 0 0 0 ${x} ${y + r}`,
    `L ${x} ${y + rh - r}`,
    `A ${r} ${r} 0 0 0 ${x + r} ${y + rh}`,
    `L ${x + rw - r} ${y + rh}`,
    `A ${r} ${r} 0 0 0 ${x + rw} ${y + rh - r}`,
    `L ${x + rw} ${y + r}`,
    `A ${r} ${r} 0 0 0 ${x + rw - r} ${y}`,
    `Z`,
  ].join(" ");
}

/** About 50% of the perimeter at full strength, then a linear fade. Colour runs along the path. */
export function EdgeOutline({ tone, radius = 19 }: { tone: "blue" | "warm"; radius?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const steps = 80;
  const d = box.w > 4 && box.h > 4 ? edgePath(box.w, box.h, radius) : "";
  return (
    <div ref={ref} className="rh-edge" aria-hidden>
      {d && (
        <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`}>
          {Array.from({ length: steps }, (_, i) => {
            const t0 = i / steps;
            const mid = (i + 0.5) / steps;
            const opacity = mid <= 0.5 ? 1 : Math.max(0, 1 - (mid - 0.5) / 0.5);
            if (opacity <= 0.03) return null;
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={tone === "warm" ? mix(mid) : BLUE}
                strokeWidth={2}
                pathLength={1}
                strokeDasharray={`${1 / steps} ${1 - 1 / steps}`}
                strokeDashoffset={-t0}
                opacity={opacity}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function Glass({
  as = "section",
  tone = "blue",
  className = "rh-card",
  radius = 19,
  children,
  testId,
}: {
  as?: "section" | "div";
  tone?: "blue" | "warm";
  className?: string;
  radius?: number;
  children: ReactNode;
  testId?: string;
}) {
  const Tag = as;
  return (
    <Tag className={className} data-testid={testId}>
      <EdgeOutline tone={tone} radius={radius} />
      <div className="rh-frost" />
      <div className="rh-body">{children}</div>
    </Tag>
  );
}

export function IntroCard({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <Glass as="div" tone="warm" className="rh-intro" radius={17} testId="role-greeting">
      <div className="rh-eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
    </Glass>
  );
}

export function Chip({ children, tone = "ready" }: { children: ReactNode; tone?: "ready" | "warn" | "neutral" | "tech" }) {
  const cls = tone === "ready" ? "rh-chip" : `rh-chip ${tone}`;
  return <span className={cls}>{children}</span>;
}

/** Same orange card as the lower "invoices waiting" notice: dark type, brown Review button. Opens the list; never sends. */
export function InvoiceBanner({
  count,
  total,
  onReview,
  onOpen,
}: {
  count: number;
  total: string;
  onReview: () => void;
  onOpen: () => void;
}) {
  return (
    <section data-testid="jobs-ready-to-invoice" className="mb-[18px] flex flex-wrap items-center gap-3 rounded-xl bg-[#F97316] p-4 text-[#0F1B2A] shadow-sm">
      <div>
        <div className="flex items-center text-[13px] font-bold uppercase tracking-wide">
          <span>Jobs ready to invoice</span>
          <InfoMark label="How jobs ready to invoice was counted" onClick={onOpen} />
        </div>
        <button type="button" className="whitespace-nowrap text-left text-[18px] font-extrabold leading-tight tabular-nums sm:text-[22px]" onClick={onReview} data-testid="jobs-ready-total">
          {count} · {total} <span className="text-[13px] font-semibold">incl. VAT</span>
        </button>
      </div>
      <button type="button" data-testid="jobs-ready-review" onClick={onReview} className="ml-auto min-h-[44px] rounded-[10px] bg-[#9A3412] px-5 text-[16px] font-bold text-white ring-2 ring-white/70 hover:bg-[#7C2D12]">Review &amp; send</button>
    </section>
  );
}

export function CashPie({ slices, onOpen, onInfo, cashHref = ADMIN_HOME_ROUTES.cash }: { slices: CashSlice[]; onOpen: (s: CashSlice) => void; onInfo?: (s: CashSlice) => void; cashHref?: string }) {
  const sum = slices.reduce((s, x) => s + Math.max(0, x.total), 0) || 1;
  let acc = 0;
  const stops = slices.map((s) => {
    const start = acc;
    acc += (Math.max(0, s.total) / sum) * 100;
    return `${s.colour} ${start}% ${acc}%`;
  }).join(", ");
  return (
    <Glass testId="cash-flow-projection">
      <Link to={cashHref} data-testid="cash-flow-heading" style={{ color: "inherit", textDecoration: "none" }}><h2>Cash flow projection</h2></Link>
      <div className="rh-muted" style={{ marginBottom: 8 }}>Expected collections · same rules as the money pies</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1 }}>
          {slices.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button type="button" className="rh-cashrow" style={{ flex: 1, width: "auto" }} onClick={() => onOpen(s)} data-testid={`cash-slice-${s.key}`}>
                <span><i className="rh-dot" style={{ background: s.colour }} />{s.label}</span>
                <b>{s.display}</b>
              </button>
              {onInfo && <InfoMark label={`How ${s.label} was counted`} onClick={() => onInfo(s)} />}
            </div>
          ))}
        </div>
        <div className="rh-donut" style={{ background: `conic-gradient(${stops})`, borderRadius: "50%", display: "grid", placeItems: "center" }} aria-hidden>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(232,246,255,.94)" }} />
        </div>
      </div>
      <p className="rh-muted" style={{ marginTop: 8 }}>Timing depends on sending and payment dates.</p>
    </Glass>
  );
}

export function RowLink({ to, children, testId }: { to: string; children: ReactNode; testId?: string }) {
  return (
    <Link to={to} className="rh-row" data-testid={testId}>
      <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
      <span className="rh-arrow">›</span>
    </Link>
  );
}
