import { Link } from "react-router-dom";
import { visibleHouseGroups, type HouseMoneyEntry, type HouseMoneyPicture, type HouseMoneyRow, type HouseMoneySide } from "@/lib/expectedMoneyHouses";

function Slot({ part, entries, omitEmpty }: { part: "deposit" | "final"; entries: HouseMoneyEntry[]; omitEmpty?: boolean }) {
  if (omitEmpty && entries.length === 0) return null;
  const shown = entries.length ? entries : [{
    key: "none", invoiceId: null, invoiceNumber: null, href: null, amountLabel: "", expectedLabel: "", chip: "Not invoiced yet", tone: "none" as const, inFigure: false,
  }];
  return (
    <div className="money-slot" data-part={part}>
      <span className="money-slot-k">{part === "deposit" ? "Deposit" : "Final"}</span>
      {shown.map((entry) => (
        <div key={entry.key} className="money-slot-body">
          {entry.href && entry.invoiceNumber
            ? <Link to={entry.href} data-testid={entry.invoiceId ? `yard-money-line-${entry.invoiceId}` : undefined}>{entry.invoiceNumber}</Link>
            : entry.invoiceNumber ? <span>{entry.invoiceNumber}</span> : null}
          {entry.amountLabel ? <b>{entry.amountLabel}</b> : null}
          {entry.expectedLabel ? <span className="yard-line-meta">{entry.expectedLabel}</span> : null}
          {entry.finalPayLabel ? <span className="yard-line-meta" data-testid={entry.invoiceId ? `final-pay-${entry.invoiceId}` : undefined}>{entry.finalPayLabel}</span> : null}
          <span className={`money-chip tone-${entry.tone}`} data-tone={entry.tone}>{entry.chip}</span>
        </div>
      ))}
    </div>
  );
}

function rowFinalDate(row: HouseMoneyRow): string {
  const dates = [...row.deposit, ...row.final].map((entry) => entry.finalPayDate).filter((day): day is string => !!day);
  dates.sort();
  return dates[0] || "9999-99-99";
}

/** One row per house. Deposit and final sit side by side so the pair can be scanned. */
export function ExpectedHousePanel({ picture, side, omitEmpty, sortBy = "house" }: { picture: HouseMoneyPicture; side: HouseMoneySide; omitEmpty?: boolean; sortBy?: "house" | "final" }) {
  const groups = visibleHouseGroups(picture, side)
    .map((group) => sortBy === "final"
      ? { ...group, rows: [...group.rows].sort((a, b) => rowFinalDate(a).localeCompare(rowFinalDate(b)) || a.house.localeCompare(b.house)) }
      : group)
    .sort((a, b) => (sortBy === "final" ? rowFinalDate(a.rows[0]).localeCompare(rowFinalDate(b.rows[0])) : 0));
  if (!groups.length) return <p className="rh-muted">Nothing in this figure.</p>;
  return (
    <div className="money-houses" data-testid="money-house-list">
      {groups.map((group) => (
        <section key={group.id} className="money-project-block" data-testid={`money-project-${group.id}`}>
          <h3 className="money-project">
            {group.name}
            {group.code ? <span className="money-project-code">{group.code}</span> : null}
          </h3>
          {group.rows.map((row) => (
            <article key={row.id} className="money-house" data-testid={`money-house-${row.id}`}>
              <div className="money-house-who">
                <b>{row.house}</b>
                {row.place ? <span className="money-house-place">{row.place}</span> : null}
                {row.client ? <span className="yard-line-meta">{row.client}</span> : null}
              </div>
              <Slot part="deposit" entries={row.deposit} omitEmpty={omitEmpty} />
              <Slot part="final" entries={row.final} omitEmpty={omitEmpty} />
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
