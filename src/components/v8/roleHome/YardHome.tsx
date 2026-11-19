import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import brandedVan from "@/assets/branded-van.png";
import type { YardHomeModel, YardMoneyTile, YardStage, YardStageView } from "@/lib/yardView";
import { homeMoneyFigures, type HomeMoneyFigure } from "@/lib/homeMoneyList";
import { narrowHousePicture } from "@/lib/expectedMoneyHouses";
import { filterLiabilityPicture } from "@/lib/liabilityLines";
import { ADMIN_HOME_ROUTES } from "@/lib/roleHome";
import { Glass } from "./chrome";
import { ExpectedMoneyBand, type ExpectedDraft, type InvoiceChoice } from "./ExpectedMoneyBand";
import { ExpectedHousePanel } from "./ExpectedHousePanel";
import { LiabilityPanel } from "./LiabilityPanel";

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

export function YardMoneyStrip({
  model,
  invoices,
  expectOpen,
  onAddExpected,
  onExpectedStatus,
  startPanel,
  startCombined,
}: {
  model: YardHomeModel;
  invoices?: InvoiceChoice[];
  expectOpen?: boolean;
  onAddExpected?: (draft: ExpectedDraft) => Promise<void>;
  onExpectedStatus?: (id: string, status: "received" | "cancelled") => Promise<void>;
  /** Harness only: open this tile on first paint. */
  startPanel?: YardMoneyTile["key"];
  /** Harness only: open Expected money instead of the one tile. */
  startCombined?: boolean;
}) {
  const figures = homeMoneyFigures(model);
  const [openKey, setOpenKey] = useState<string | null>(startPanel === "liabilities" ? "liabilities-all" : (startPanel ?? null));
  useEffect(() => {
    if (!startPanel) return;
    const panel = document.querySelector("[data-testid='yard-money-panel']");
    if (panel && typeof panel.scrollIntoView === "function") panel.scrollIntoView({ block: "start" });
  }, [startPanel]);
  const [combined, setCombined] = useState(!!startCombined);
  const figure = figures.find((row) => row.key === openKey) || null;
  const toggle = (key: string) => setOpenKey((cur) => (cur === key ? null : key));
  return (
      <Glass testId="yard-metrics">
        <ul className="money-figures" data-testid="money-figures">
          {figures.map((row) => row.heading ? (
            <li key={row.key} className="money-figure-heading">{row.label}</li>
          ) : (
            <li key={row.key}>
              <button type="button" className={row.tone === "bar" ? "money-figure money-figure-bar" : "money-figure"} data-testid={row.testId} aria-expanded={openKey === row.key} onClick={() => toggle(row.key)}>
                <span className="money-figure-label">{row.label}</span>
                <span className="money-figure-amt">
                  {row.amountLines ? row.amountLines.map((line) => <span key={line}>{line}</span>) : row.amountLabel}
                </span>
                <span className="money-figure-explain" data-testid={row.dateTestId}>{row.explain}</span>
                {row.stale ? <span className="yard-stale" data-testid={`money-stale-${row.key}`}>{row.stale}</span> : null}
                <span className="money-figure-info" data-testid={`money-info-${row.key}`}>
                  <span className="money-figure-i" aria-hidden="true">i</span>
                  <span>{row.info}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {openKey === "liabilities-all" && model.liabilities.liabilities && (
          <Detail title="Liabilities" testId="yard-money-panel" onClose={() => setOpenKey(null)} href={model.liabilities.href} action="Open the list">
            <LiabilityPanel picture={model.liabilities.liabilities} />
          </Detail>
        )}
        {figure && <MoneyPanel figure={figure} model={model} combined={combined} onCombined={setCombined} onClose={() => setOpenKey(null)} />}
        <ExpectedMoneyBand
          picture={model.expected}
          invoices={invoices}
          startOpen={expectOpen}
          onAdd={onAddExpected}
          onStatus={onExpectedStatus}
          showTiles={false}
        />
      </Glass>
  );
}

function LineList({ lines }: { lines: { id: string; label: string; amountLabel: string; dateLabel: string; href: string }[] }) {
  return (
    <ul className="yard-lines">
      {lines.map((line) => (
        <li key={line.id}>
          <Link to={line.href} data-testid={`yard-money-line-${line.id}`}>
            <span>{line.label}</span>
            {line.dateLabel ? <span className="yard-line-meta">{line.dateLabel}</span> : null}
            {line.amountLabel ? <b>{line.amountLabel}</b> : null}
          </Link>
        </li>
      ))}
      {lines.length === 0 && <li className="rh-muted">Nothing in this figure.</li>}
    </ul>
  );
}

function MoneyPanel({
  figure, model, combined, onCombined, onClose,
}: {
  figure: HomeMoneyFigure;
  model: YardHomeModel;
  combined: boolean;
  onCombined: (next: boolean) => void;
  onClose: () => void;
}) {
  const [finalSort, setFinalSort] = useState(false);
  const panel = figure.panel;
  if (panel.kind === "deposits" || panel.kind === "finals") {
    const side = combined ? "both" : panel.kind;
    const tile = panel.kind === "finals" ? model.finals : model.deposits;
    return (
      <Detail title={combined ? "Expected money" : figure.label} testId="yard-money-panel" onClose={onClose} href={tile.href} action="Open the list" rule={tile.rule}>
        <div className="money-view-toggle" role="group" aria-label="Expected money view">
          <button type="button" aria-pressed={!combined} data-testid="money-view-side" onClick={() => onCombined(false)}>{panel.kind === "finals" ? "Finals" : "Deposits"}</button>
          <button type="button" aria-pressed={combined} data-testid="money-view-both" onClick={() => onCombined(true)}>Expected money</button>
        </div>
        <div className="money-view-toggle" role="group" aria-label="Sort the list">
          <button type="button" aria-pressed={!finalSort} data-testid="money-sort-house" onClick={() => setFinalSort(false)}>House</button>
          <button type="button" aria-pressed={finalSort} data-testid="money-sort-final" onClick={() => setFinalSort(true)}>Expected final payment</button>
        </div>
        <ExpectedHousePanel picture={model.expectedHouses} side={side} sortBy={finalSort ? "final" : "house"} />
      </Detail>
    );
  }
  if (panel.kind === "window" || panel.kind === "projected") {
    const picture = narrowHousePicture(model.expectedHouses, (entry, part) => {
      const ids = part === "deposit" ? panel.depositIds : panel.finalIds;
      return !!entry.invoiceId && ids.includes(entry.invoiceId);
    });
    return (
      <Detail title={figure.label} testId="yard-money-panel" onClose={onClose} href={figure.href} action={figure.action} rule={figure.info}>
        {panel.kind === "projected" && (
          <ul className="yard-lines" data-testid="money-projected-formula">
            <li><span>Cash on hand</span><b>{model.expected.cashLabel}</b></li>
            <li><span>Money due in 30 days, including overdue</span><b>{model.expected.next30Label}</b></li>
            <li><span>Projected</span><b>{model.expected.projectedLabel}</b></li>
            <li className="rh-muted">Liabilities are not subtracted.</li>
          </ul>
        )}
        {picture.groups.length > 0 && <ExpectedHousePanel picture={picture} side="both" omitEmpty />}
        {panel.extras.length > 0 && <LineList lines={panel.extras} />}
        {picture.groups.length === 0 && panel.extras.length === 0 && panel.kind === "window" && <p className="rh-muted">Nothing in this figure.</p>}
      </Detail>
    );
  }
  if (panel.kind === "liabilities") {
    const source = model.liabilities.liabilities;
    const today = model.today;
    const picture = source
      ? filterLiabilityPicture(source, (line) => {
        if (panel.when === "all") return true;
        if (panel.when === "overdue") return !!line.payDate && line.payDate < today;
        return !line.payDate || line.payDate >= today;
      })
      : null;
    return (
      <Detail title={figure.label} testId="yard-money-panel" onClose={onClose} href={figure.href} action={figure.action}>
        {picture ? <LiabilityPanel picture={picture} /> : <p className="rh-muted">{figure.explain}</p>}
      </Detail>
    );
  }
  if (panel.kind === "cash") {
    return (
      <Detail title={figure.label} testId="yard-money-panel" onClose={onClose} href={model.cash.href} action="Open the list" rule={model.cash.rule}>
        <LineList lines={figure.lines} />
      </Detail>
    );
  }
  return (
    <Detail title={figure.label} testId="yard-money-panel" onClose={onClose} href={figure.href} action={figure.action} rule={figure.info}>
      <LineList lines={figure.lines} />
    </Detail>
  );
}

export function YardWork({ model, yardPageHref }: { model: YardHomeModel; yardPageHref?: string }) {
  const [stageKey, setStageKey] = useState<YardStage | null>(null);
  const stage = stageKey ? model.stages.find((row) => row.key === stageKey) || null : null;
  return (
    <div id="work-in-motion" data-testid="work-in-motion">
      <Glass testId="yard-work">
          <div className="yard-work-head">
            <h2>Work in motion</h2>
            <span className="yard-work-links">
              <Link to={ADMIN_HOME_ROUTES.bookJob} data-testid="book-today-job">Book a job</Link>
              {yardPageHref
                ? <Link to={yardPageHref} data-testid="yard-page-link">Yard view</Link>
                : <span>Yard view</span>}
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
    </div>
  );
}

export function YardHome({
  model,
  yardPageHref,
  invoices,
  expectOpen,
  onAddExpected,
  onExpectedStatus,
  startPanel,
  startCombined,
}: {
  model: YardHomeModel;
  yardPageHref?: string;
  invoices?: InvoiceChoice[];
  expectOpen?: boolean;
  onAddExpected?: (draft: ExpectedDraft) => Promise<void>;
  onExpectedStatus?: (id: string, status: "received" | "cancelled") => Promise<void>;
  startPanel?: YardMoneyTile["key"];
  startCombined?: boolean;
}) {
  return (
    <>
      <YardMoneyStrip model={model} invoices={invoices} expectOpen={expectOpen} onAddExpected={onAddExpected} onExpectedStatus={onExpectedStatus} startPanel={startPanel} startCombined={startCombined} />
      <YardWork model={model} yardPageHref={yardPageHref} />
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
