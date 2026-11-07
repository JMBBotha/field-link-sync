import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import brandedVan from "@/assets/branded-van.png";
import type { YardHomeModel, YardMoneyTile, YardStage, YardStageView } from "@/lib/yardView";
import { ADMIN_HOME_ROUTES } from "@/lib/roleHome";
import { Glass } from "./chrome";

/** Smaller than the bay, matching the sketch. The box is taller than the artwork so contain does not crop the tyres. */
const VAN_STYLE = {
  display: "block",
  width: "118px",
  maxWidth: "70%",
  height: "58px",
  objectFit: "contain" as const,
  objectPosition: "center bottom",
  background: "transparent",
  overflow: "visible" as const,
};

function MoneyButton({ tile, open, onOpen }: { tile: YardMoneyTile; open: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="yard-metric" data-testid={`money-${tile.key}`} aria-expanded={open} onClick={onOpen}>
      <span className="yard-k">{tile.label}</span>
      <span className="yard-amt">{tile.amountLabel ?? "—"}</span>
      <span className="yard-when" data-testid={`money-date-${tile.key}`}>{tile.dateLine}</span>
    </button>
  );
}

function Detail({
  title,
  testId,
  onClose,
  href,
  action,
  rule,
  children,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  href: string;
  action: string;
  rule?: string;
  children: ReactNode;
}) {
  return (
    <div className="yard-panel" data-testid={testId} role="region" aria-label={title}>
      <div className="yard-panel-head">
        <b>{title}</b>
        <button type="button" onClick={onClose} data-testid={`${testId}-close`}>Close</button>
      </div>
      {rule && <p className="rh-muted">{rule}</p>}
      {children}
      <Link to={href} className="yard-panel-go">{action}</Link>
    </div>
  );
}

function StageArt({ stage }: { stage: YardStage }) {
  if (stage === "waiting") {
    return (
      <svg className="yard-building" viewBox="0 0 120 78" aria-hidden>
        <path d="M8 34 L60 10 L112 34 V74 H8 Z" fill="rgba(255,255,255,.55)" stroke="#7f9aaf" strokeWidth="2" />
        <path d="M28 74 V46 H92 V74" fill="rgba(214,228,238,.9)" stroke="#7f9aaf" strokeWidth="2" />
        <path d="M46 74 V54 H74 V74" fill="none" stroke="#7f9aaf" strokeWidth="2" />
      </svg>
    );
  }
  if (stage === "on_site") {
    return (
      <svg className="yard-building" viewBox="0 0 120 78" aria-hidden>
        <path d="M14 36 L60 12 L106 36 V74 H14 Z" fill="rgba(255,255,255,.62)" stroke="#7f9aaf" strokeWidth="2" />
        <rect x="50" y="46" width="20" height="28" fill="none" stroke="#7f9aaf" strokeWidth="2" />
        <rect x="26" y="44" width="16" height="14" fill="none" stroke="#7f9aaf" strokeWidth="2" />
        <rect x="78" y="44" width="16" height="14" fill="none" stroke="#7f9aaf" strokeWidth="2" />
      </svg>
    );
  }
  if (stage === "done") {
    return (
      <svg className="yard-building yard-done-bay" viewBox="0 0 120 78" aria-hidden>
        <path d="M16 40 H104 V74 H16 Z" fill="rgba(255,255,255,.35)" stroke="#7f9aaf" strokeWidth="2" />
        <path d="M10 40 H110" stroke="#8eaf62" strokeWidth="6" strokeLinecap="round" />
        <circle cx="60" cy="22" r="14" fill="#3c9a57" />
        <path d="M52 22 l6 6 12-13" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

function Bay({ stage, onOpen }: { stage: YardStageView; onOpen: () => void }) {
  const van = stage.count > 0 ? (
    <img src={brandedVan} alt="" data-testid={`yard-van-${stage.key}`} style={VAN_STYLE} />
  ) : null;
  const body = (
    <>
      <span className="yard-place">{stage.key === "done" ? "" : stage.place}</span>
      <span className="yard-art">
        <StageArt stage={stage.key} />
        {van}
      </span>
      <span className="yard-cap"><b>{stage.count}</b> {stage.caption}</span>
    </>
  );
  if (stage.count === 0) {
    return (
      <div className="yard-bay" data-testid={`yard-bay-${stage.key}`} data-count="0" style={{ overflow: "visible" }}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className="yard-bay" data-testid={`yard-bay-${stage.key}`} data-count={stage.count} style={{ overflow: "visible" }} onClick={onOpen} aria-label={`${stage.count} ${stage.caption}`}>
      {body}
    </button>
  );
}

export function YardHome({ model }: { model: YardHomeModel }) {
  const [money, setMoney] = useState<YardMoneyTile["key"] | null>(null);
  const [stageKey, setStageKey] = useState<YardStage | null>(null);
  const tile = money ? [model.cash, model.liabilities, model.deposits, model.finals].find((row) => row.key === money) || null : null;
  const stage = stageKey ? model.stages.find((row) => row.key === stageKey) || null : null;
  const openMoney = (key: YardMoneyTile["key"]) => setMoney((cur) => (cur === key ? null : key));
  return (
    <>
      <Glass testId="yard-metrics">
        <div className="yard-metrics">
          <MoneyButton tile={model.cash} open={money === "cash"} onOpen={() => openMoney("cash")} />
          <MoneyButton tile={model.liabilities} open={money === "liabilities"} onOpen={() => openMoney("liabilities")} />
          <MoneyButton tile={model.deposits} open={money === "deposits"} onOpen={() => openMoney("deposits")} />
          <MoneyButton tile={model.finals} open={money === "finals"} onOpen={() => openMoney("finals")} />
          <Link to={model.openLeads.href} className="yard-metric" data-testid="money-open-leads">
            <span className="yard-k">Open leads</span>
            <span className="yard-amt">{model.openLeads.count}</span>
            <span className="yard-when">Not booked yet</span>
          </Link>
          <div className="yard-metric yard-jobs" data-testid="money-jobs">
            <span className="yard-k">Jobs</span>
            <span className="yard-jobline">
              <Link to={model.jobs.todayHref}><b>{model.jobs.today}</b> <span>today</span></Link>
              <Link to={model.jobs.weekHref}><b>{model.jobs.week}</b> <span>this week</span></Link>
              <Link to={model.jobs.monthHref}><b>{model.jobs.month}</b> <span>this month</span></Link>
            </span>
          </div>
        </div>
        {tile && (
            <Detail title={tile.label} testId="yard-money-panel" onClose={() => setMoney(null)} href={tile.href} action="Open the list" rule={tile.rule}>
              <ul className="yard-lines">
                {tile.lines.map((line) => (
                  <li key={line.id}>
                    <Link to={line.href} data-testid={`yard-money-line-${line.id}`}>
                      <span>{line.label}</span>
                      <span className="yard-line-meta">{line.dateLabel}</span>
                      <b>{line.amountLabel}</b>
                    </Link>
                  </li>
                ))}
                {tile.lines.length === 0 && <li className="rh-muted">Nothing in this figure.</li>}
              </ul>
            </Detail>
        )}
      </Glass>

      <Glass testId="yard-work">
          <div className="yard-work-head">
            <h2>Work in motion</h2>
            <span className="yard-work-links">
              <Link to={ADMIN_HOME_ROUTES.bookJob} data-testid="book-today-job">Book a job</Link>
              <span>Yard view</span>
            </span>
          </div>
          <div className="yard-scene" data-testid="yard-scene" style={{ overflow: "visible" }}>
            <svg className="yard-road" viewBox="0 0 1000 90" preserveAspectRatio="none" aria-hidden>
              <path d="M0 58 C 180 20, 360 78, 540 46 S 860 20, 1000 50" fill="none" stroke="#c5d0d8" strokeWidth="28" strokeLinecap="round" />
              <path d="M0 58 C 180 20, 360 78, 540 46 S 860 20, 1000 50" fill="none" stroke="#f7fbfe" strokeWidth="3" strokeDasharray="16 14" strokeLinecap="round" />
            </svg>
            <div className="yard-bays">
              {model.stages.map((row) => (
                <Bay key={row.key} stage={row} onOpen={() => setStageKey((cur) => (cur === row.key ? null : row.key))} />
              ))}
            </div>
          </div>
          {stage && stage.count > 0 && (
            <Detail title={`${stage.count} ${stage.caption}`} testId="yard-stage-panel" onClose={() => setStageKey(null)} href="/admin/schedule" action="Open the schedule">
              <ul className="yard-lines">
                {stage.jobs.map((job) => (
                  <li key={job.id}>
                    <Link to={job.href} data-testid={`yard-job-${job.id}`}>
                      <span><b>{job.customer}</b> · {job.type}</span>
                      <span className="yard-line-meta">{job.when} · {job.assignee}</span>
                      <span className="yard-line-meta">{job.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Detail>
          )}
          <div className="yard-sales-label">Sales leads</div>
          <div className="yard-sales" data-testid="yard-sales">
            {model.sales.map((box) => (
              <Link key={box.key} to={box.href} className="yard-sale" data-testid={`sales-${box.key}`}>
                <SaleIcon kind={box.key} />
                <span><b>{box.count}</b><span>{box.label}</span></span>
              </Link>
            ))}
          </div>
      </Glass>
    </>
  );
}

function SaleIcon({ kind }: { kind: YardHomeModel["sales"][number]["key"] }) {
  const common = { width: 28, height: 28, viewBox: "0 0 28 28", fill: "none", "aria-hidden": true as const };
  if (kind === "new") {
    return <svg {...common}><circle cx="14" cy="14" r="11" stroke="#3d9beb" strokeWidth="1.6" /><path d="M14 8 v12 M8 14 h12" stroke="#3d9beb" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  }
  if (kind === "quoting") {
    return <svg {...common}><path d="M8 5 h9 l4 4 v14 H8 Z" stroke="#3d9beb" strokeWidth="1.6" /><path d="M16 5 v5 h5 M11 14 h7 M11 18 h7" stroke="#3d9beb" strokeWidth="1.4" strokeLinecap="round" /></svg>;
  }
  if (kind === "waiting") {
    return <svg {...common}><circle cx="14" cy="14" r="11" stroke="#3d9beb" strokeWidth="1.6" /><path d="M14 8 v7 l4 2" stroke="#3d9beb" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  }
  return <svg {...common}><circle cx="14" cy="14" r="11" stroke="#3d9beb" strokeWidth="1.6" /><path d="M9 14 l3.5 3.5 L19 10" stroke="#3d9beb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
