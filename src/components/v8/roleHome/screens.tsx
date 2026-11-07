import { useState } from "react";
import { Link } from "react-router-dom";
import type { MaterialCheck, MaterialLine, StockLevel, StockOrder } from "@/lib/materialCheck";
import { checkSummary } from "@/lib/materialCheck";
import type { CashSlice } from "@/lib/roleHome";
import { ADMIN_HOME_ROUTES } from "@/lib/roleHome";
import type { YardHomeModel, YardMoneyTile } from "@/lib/yardView";
import { CashPie, Chip, Glass, IntroCard, InvoiceBanner, RowLink } from "./chrome";
import { YardHome } from "./YardHome";

const quietLink = { color: "inherit", textDecoration: "none" } as const;

export interface HomeJob {
  id: string;
  href: string;
  time: string;
  type: string;
  area: string;
  client: string;
  check: MaterialCheck | null;
}

export interface HomeAppointment {
  id: string;
  href: string;
  time: string;
  type: string;
  place: string;
  chip?: { label: string; tone: "neutral" | "tech" } | null;
}

export interface BookedJob {
  id: string;
  href: string;
  when: string;
  type: string;
  client: string;
  area: string;
  tech?: string | null;
}

export interface TodayCrew {
  id: string;
  href: string;
  who: string;
  type: string;
  where: string;
  client: string;
}

function SummaryChip({ check }: { check: MaterialCheck | null }) {
  if (!check) return null;
  const s = checkSummary(check);
  if (!s) return null;
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

export function MaterialBlock({ check, quoteHref }: { check: MaterialCheck; quoteHref?: string | null }) {
  if (!check.show) return null;
  const picked = check.lines.filter((l) => l.status === "ready").length;
  const counted = check.lines.filter((l) => l.status === "ready" || l.status === "to_pick").length;
  return (
    <Glass testId="material-check">
      <div className="rh-head">
        <h2>Material check</h2>
        {counted > 0 && <span className="rh-muted">{picked} of {counted} ready</span>}
      </div>
      {check.lines.map((l) => <MaterialRow key={l.id} line={l} fallbackHref={quoteHref} />)}
    </Glass>
  );
}

function MaterialRow({ line, fallbackHref }: { line: MaterialLine; fallbackHref?: string | null }) {
  if (line.status === "note") return <p className="rh-note" data-testid="material-note">{line.label}</p>;
  const href = line.href || fallbackHref;
  const body = (
    <>
      <span>{line.label}</span>
      {line.status === "ready" && <Chip>Ready</Chip>}
      {line.status === "to_pick" && <Chip tone="warn">To pick</Chip>}
      {line.status === "unspecified" && <Chip tone="warn">Not specified</Chip>}
      {line.status === "stock_unknown" && <Chip tone="neutral">Stock not loaded</Chip>}
    </>
  );
  if (!href) return <div className="rh-material" data-testid={`material-${line.id}`}>{body}</div>;
  return <Link to={href} className="rh-material" data-testid={`material-${line.id}`}>{body}</Link>;
}

export function TechHomeScreen({ eyebrow, title, jobs }: { eyebrow: string; title: string; jobs: HomeJob[] }) {
  return (
    <div data-testid="role-tech-home">
      <IntroCard eyebrow={eyebrow} title={title} />
      <Glass>
        <div className="rh-head"><h2>Today’s jobs</h2><span className="rh-count">{jobs.length}</span></div>
        {jobs.length === 0 && <p className="rh-muted">No jobs today.</p>}
        {jobs.map((j, i) => {
          const inner = (
            <>
              <div className="rh-time">{j.time} <span>· {j.type}</span></div>
              <h3>{j.area}</h3>
              <div className="rh-muted">{j.client}</div>
              <SummaryChip check={j.check} />
            </>
          );
          if (i === 0) {
            return (
              <Glass key={j.id} as="div" className="rh-nest" radius={14} testId="tech-job-first">
                <RowLink to={j.href} testId="tech-job-row">{inner}</RowLink>
              </Glass>
            );
          }
          return <RowLink key={j.id} to={j.href} testId="tech-job-row">{inner}</RowLink>;
        })}
      </Glass>
    </div>
  );
}

export function JobIntro({
  kicker,
  title,
  sub,
  eyebrow,
  headline,
  meta,
}: {
  kicker: string;
  title: string;
  sub: string;
  eyebrow: string;
  headline: string;
  meta: string[];
}) {
  return (
    <>
      <Glass as="div" tone="warm" className="rh-intro" radius={17}>
        <div className="rh-eyebrow">{kicker}</div>
        <h1 style={{ fontSize: 26 }}>{title}</h1>
        <div className="rh-muted">{sub}</div>
      </Glass>
      <Glass tone="warm" testId="job-intro">
        <div className="rh-label">{eyebrow}</div>
        <div className="rh-big">{headline}</div>
        {meta.filter(Boolean).map((line) => <div key={line} className="rh-muted">{line}</div>)}
      </Glass>
    </>
  );
}

export function ContactAddress({
  client,
  phone,
  address,
  navHref,
}: {
  client: string;
  phone?: string | null;
  address?: string | null;
  navHref?: string | null;
}) {
  return (
    <>
      <Glass>
        <div className="rh-label">Contact details</div>
        <div className="rh-big" style={{ fontSize: 22 }}>{client}</div>
        <div className="rh-muted">{phone || "No number on this job"}</div>
        {phone ? <a className="rh-btn secondary" style={{ marginTop: 12 }} href={`tel:${phone}`}>Call client</a> : <span className="rh-btn secondary" style={{ marginTop: 12, opacity: .6 }}>Call client</span>}
      </Glass>
      <Glass>
        <div className="rh-label">Address</div>
        <div className="rh-big" style={{ fontSize: 22 }}>{address || "No address on this job"}</div>
        {navHref ? <a className="rh-btn secondary" style={{ marginTop: 12 }} href={navHref} target="_blank" rel="noreferrer">Navigate →</a> : null}
      </Glass>
    </>
  );
}

export function ImagesBlock({ description, photos }: { description?: string | null; photos?: { url: string; label: string }[] }) {
  const [open, setOpen] = useState(true);
  return (
    <Glass>
      <button type="button" className="rh-head" style={{ width: "100%", background: "none", border: 0 }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <h2>Images &amp; description</h2>
        <span className="rh-arrow">{open ? "⌃" : "⌄"}</span>
      </button>
      {open && (
        <>
          <div className="rh-thumbs">
            {(photos && photos.length ? photos : [{ url: "", label: "Indoor position" }, { url: "", label: "Outdoor position" }]).slice(0, 2).map((p) => (
              <div key={p.label} className="rh-thumb">{p.url ? <img src={p.url} alt={p.label} /> : p.label}</div>
            ))}
          </div>
          <p className="rh-muted">{description || "No description on this job."}</p>
        </>
      )}
    </Glass>
  );
}

export function TechJobScreen(props: {
  type: string;
  client: string;
  area: string;
  when: string;
  duration?: string | null;
  phone?: string | null;
  address?: string | null;
  navHref?: string | null;
  check: MaterialCheck;
  quoteHref?: string | null;
  description?: string | null;
  photos?: { url: string; label: string }[];
  onLogParts: () => void;
  onComplete: () => void;
  completeDisabled?: boolean;
}) {
  return (
    <div data-testid="role-tech-job">
      <JobIntro
        kicker="Today’s jobs"
        title={props.type}
        sub={`${props.client} · ${props.area}`}
        eyebrow="This is your job"
        headline={props.when}
        meta={[`${props.type} · ${props.area}`, props.client, props.duration || ""].filter(Boolean)}
      />
      <ContactAddress client={props.client} phone={props.phone} address={props.address} navHref={props.navHref} />
      <MaterialBlock check={props.check} quoteHref={props.quoteHref} />
      <ImagesBlock description={props.description} photos={props.photos} />
      <div className="rh-actions">
        <button type="button" className="rh-btn secondary" onClick={props.onLogParts} data-testid="log-parts">Log parts</button>
        <button type="button" className="rh-btn" onClick={props.onComplete} disabled={props.completeDisabled} data-testid="job-complete">Job complete</button>
      </div>
    </div>
  );
}

export function SalesHomeScreen({
  eyebrow, title, appointments, booked,
}: {
  eyebrow: string;
  title: string;
  appointments: HomeAppointment[];
  booked: BookedJob[];
}) {
  return (
    <div data-testid="role-sales-home">
      <IntroCard eyebrow={eyebrow} title={title} />
      <Glass>
        <div className="rh-head"><h2>Today’s appointments</h2><span className="rh-count">{appointments.length}</span></div>
        {appointments.length === 0 && <p className="rh-muted">No appointments today.</p>}
        {appointments.map((a) => (
          <RowLink key={a.id} to={a.href} testId="sales-appointment">
            <b>{a.time} · {a.type}</b>
            <div className="rh-muted">{a.place}</div>
            {a.chip && <Chip tone={a.chip.tone}>{a.chip.label}</Chip>}
          </RowLink>
        ))}
      </Glass>
      <Glass>
        <div className="rh-head"><h2>Jobs booked under your name</h2><span className="rh-count">{booked.length}</span></div>
        {booked.length === 0 && <p className="rh-muted">Jobs you booked or are assigned to show here.</p>}
        {booked.map((j) => (
          <RowLink key={j.id} to={j.href} testId="sales-booked-job">
            <b>{j.when} · {j.type}</b>
            <div className="rh-muted">{j.client} · {j.area}</div>
            <Chip tone="tech">{j.tech || "No technician yet"}</Chip>
          </RowLink>
        ))}
      </Glass>
    </div>
  );
}

export function SalesJobScreen(props: {
  type: string;
  client: string;
  area: string;
  when: string;
  duration?: string | null;
  tech?: string | null;
  phone?: string | null;
  address?: string | null;
  navHref?: string | null;
  check: MaterialCheck;
  quoteHref: string;
  description?: string | null;
  photos?: { url: string; label: string }[];
}) {
  return (
    <div data-testid="role-sales-job">
      <JobIntro
        kicker="Booked jobs"
        title={props.type}
        sub={`${props.client} · ${props.area}`}
        eyebrow="This is your job"
        headline={props.when}
        meta={[
          `${props.type} · ${props.area}`,
          props.client,
          [props.duration, props.tech ? `Assigned technician: ${props.tech}` : "No technician yet"].filter(Boolean).join(" · "),
        ]}
      />
      <ContactAddress client={props.client} phone={props.phone} address={props.address} navHref={props.navHref} />
      <MaterialBlock check={props.check} quoteHref={props.quoteHref} />
      <ImagesBlock description={props.description} photos={props.photos} />
      <Link to={props.quoteHref} className="rh-btn" data-testid="open-quote">Open quote →</Link>
    </div>
  );
}

const HOME_MONEY_ORDER: YardMoneyTile["key"][] = ["cash", "liabilities", "deposits", "finals"];

function MoneyAccountBlock({ tiles, loading }: { tiles: YardMoneyTile[] | null; loading?: boolean }) {
  const byKey = new Map((tiles || []).map((tile) => [tile.key, tile]));
  const rows = HOME_MONEY_ORDER.map((key) => byKey.get(key)).filter((tile): tile is YardMoneyTile => !!tile);
  return (
    <Glass testId="money-in-account">
      <div className="rh-head">
        <Link to={ADMIN_HOME_ROUTES.cash} data-testid="money-in-account-heading" style={quietLink}><h2>Money in account</h2></Link>
      </div>
      <div className="rh-muted">Cash on hand, liabilities, and payments expected in</div>
      {loading && rows.length === 0 && <p className="rh-muted" data-testid="money-in-account-loading">Loading…</p>}
      {!loading && rows.length === 0 && <p className="rh-muted" data-testid="money-in-account-empty">These figures could not be loaded.</p>}
      {rows.map((tile) => (
        <Link key={tile.key} to={tile.href} className="rh-material home-money-row" data-testid={`home-money-${tile.key}`}>
          <span>
            <b style={{ display: "block" }}>{tile.label}</b>
            <span className="rh-muted" data-testid={`home-money-date-${tile.key}`}>{tile.dateLine}</span>
          </span>
          <span className="home-money-side">
            <b className="home-money-amt" data-testid={`home-money-amount-${tile.key}`}>{tile.amountLabel ?? "—"}</b>
            <span className="rh-arrow">›</span>
          </span>
        </Link>
      ))}
    </Glass>
  );
}

export function AdminHomeScreen({
  eyebrow, title, invoice, crew, levels, orders, slices, money, moneyLoading, onSlice, onSliceInfo, onReview, onInvoice,
  jobsHref = ADMIN_HOME_ROUTES.jobs,
  bookHref = ADMIN_HOME_ROUTES.bookJob,
  mapHref = ADMIN_HOME_ROUTES.map,
  stockHref = ADMIN_HOME_ROUTES.stock,
  yardHref = ADMIN_HOME_ROUTES.yard,
}: {
  eyebrow: string;
  title: string;
  invoice: { count: number; total: string } | null;
  crew: TodayCrew[];
  levels: StockLevel[];
  orders: StockOrder[];
  slices: CashSlice[];
  money: YardMoneyTile[] | null;
  moneyLoading?: boolean;
  onSlice: (s: CashSlice) => void;
  onSliceInfo?: (s: CashSlice) => void;
  onReview: () => void;
  onInvoice: () => void;
  jobsHref?: string;
  bookHref?: string;
  mapHref?: string;
  stockHref?: string;
  yardHref?: string;
}) {
  return (
    <div data-testid="role-admin-home">
      <IntroCard eyebrow={eyebrow} title={title} />
      {invoice && invoice.count > 0 && <InvoiceBanner count={invoice.count} total={invoice.total} onReview={onReview} onOpen={onInvoice} />}
      <div className="rh-grid">
        <div className="rh-span">
          <MoneyAccountBlock tiles={money} loading={moneyLoading} />
        </div>
        <Glass>
          <div className="rh-head">
            <Link to={jobsHref} data-testid="today-jobs-heading" style={quietLink}><h2>Jobs being done today</h2></Link>
            <span className="home-job-tools">
              <Link to={yardHref} data-testid="open-yard-view" className="home-yard-link">Yard view</Link>
              <span className="rh-count">{crew.length}</span>
            </span>
          </div>
          <Link to={mapHref} className="rh-muted" data-testid="who-is-where" style={quietLink}>{crew.length} on site · who is where</Link>
          {crew.length === 0 && <p className="rh-muted">Nothing booked today.</p>}
          {crew.slice(0, 5).map((c) => (
            <RowLink key={c.id} to={c.href} testId="admin-today-job">
              <b>{c.who} · {c.type}</b>
              <div className="rh-muted">{c.where} · {c.client}</div>
            </RowLink>
          ))}
          {crew.length > 5 && <Link to={jobsHref} className="rh-muted">View all {crew.length} jobs →</Link>}
          <Link to={bookHref} className="rh-btn" data-testid="book-today-job" style={{ marginTop: 12 }}>Book a job</Link>
        </Glass>
        <Glass testId="material-stock-levels">
          <Link to={stockHref} data-testid="stock-levels-heading" style={quietLink}><h2>Material &amp; stock levels</h2></Link>
          <div className="rh-muted">On hand against what this week’s checks need</div>
          {levels.length === 0 && <p className="rh-muted">No quoted materials to compare yet.</p>}
          {levels.slice(0, 6).map((l) => (
            <Link key={l.key} to={l.href} className="rh-material" data-testid="stock-level">
              <span><b style={{ display: "block" }}>{l.name}</b><span className="rh-muted">{l.detail}</span></span>
              {l.short != null && l.short > 0 && <Chip tone="warn">{l.short} short</Chip>}
            </Link>
          ))}
        </Glass>
        <Glass testId="stock-orders">
          <div className="rh-head">
            <Link to={stockHref} data-testid="stock-orders-heading" style={quietLink}><h2>Stock orders this week</h2></Link>
            <span className="rh-count">{orders.length}</span>
          </div>
          <div className="rh-muted">From upcoming job material checks</div>
          {orders.length === 0 && <p className="rh-muted">Nothing short against stock.</p>}
          {orders.map((o) => (
            <Link key={o.key} to={o.href} className="rh-material" data-testid="stock-order">
              <span><b style={{ display: "block" }}>{o.label}</b><span className="rh-muted">{o.detail}</span></span>
              <span className="rh-arrow">›</span>
            </Link>
          ))}
          {orders.length > 0 && <Link to={stockHref} className="rh-btn secondary" style={{ marginTop: 8 }} data-testid="stock-orders-review">Review {orders.length} item{orders.length === 1 ? "" : "s"} to order →</Link>}
        </Glass>
        <CashPie slices={slices} onOpen={onSlice} onInfo={onSliceInfo} />
      </div>
    </div>
  );
}

/** The living picture that used to be admin Home. Its own page now. */
export function YardViewScreen({
  eyebrow, title, companyName, invoice, model, loading, error, onReview, onInvoice,
}: {
  eyebrow: string;
  title: string;
  companyName?: string | null;
  invoice: { count: number; total: string } | null;
  model: YardHomeModel | null;
  loading?: boolean;
  error?: boolean;
  onReview: () => void;
  onInvoice: () => void;
}) {
  return (
    <div data-testid="role-yard-view">
      <Glass as="div" tone="warm" className="rh-intro" radius={17} testId="role-greeting">
        <div className="yard-greet">
          <div>
            <div className="rh-eyebrow">{eyebrow}</div>
            <h1>{title}</h1>
          </div>
          <div className="yard-co">
            {companyName ? <b>{companyName}</b> : null}
            <span>Company overview</span>
          </div>
        </div>
      </Glass>
      {invoice && invoice.count > 0 && <InvoiceBanner count={invoice.count} total={invoice.total} onReview={onReview} onOpen={onInvoice} />}
      {model && <YardHome model={model} />}
      {!model && loading && <p className="rh-muted" data-testid="yard-loading">Loading the yard…</p>}
      {!model && error && <p className="rh-muted" data-testid="yard-error">The yard could not load.</p>}
    </div>
  );
}
