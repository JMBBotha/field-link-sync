import { Link } from "react-router-dom";
import type { LiabilityPicture } from "@/lib/liabilityLines";
import "./roleHome.css";

/** The same rows on Home and on Cash-flow health. Each line opens the job, or the invoice. */
export function LiabilityPanel({ picture }: { picture: LiabilityPicture }) {
  return (
    <div className="money-houses" data-testid="liability-list">
      <p className="money-source" data-testid="liability-source">{picture.source}</p>
      {picture.groups.length === 0 && <p className="rh-muted">Nothing still to buy.</p>}
      {picture.groups.map((group) => (
        <section key={group.id} className="money-project-block" data-testid={`liability-project-${group.id}`}>
          <h3 className="money-project">
            {group.name}
            {group.code ? <span className="money-project-code">{group.code}</span> : null}
          </h3>
          {group.rows.map((row) => (
            <div key={row.id} className="money-liab-house" data-testid={`liability-house-${row.id}`}>
              <div className="money-house-who">
                <b>{row.house}</b>
                {row.place ? <span className="money-house-place">{row.place}</span> : null}
                {row.client ? <span className="yard-line-meta">{row.client}</span> : null}
              </div>
              {row.lines.map((line) => (
                <Link key={line.id} to={line.href} className="money-liab-line" data-testid={`yard-money-line-${line.id}`}>
                  <span className="money-liab-who">
                    {line.client}
                    {line.invoiceNumber ? ` · ${line.invoiceNumber}` : ""}
                    {line.supplier ? ` · ${line.supplier}` : ""}
                  </span>
                  <span className="money-liab-item">
                    <b>{line.code}</b>
                    {line.description ? <span> · {line.description}</span> : null}
                  </span>
                  <span className="yard-line-meta">{line.qtyLabel} · {line.payLabel}</span>
                  <b className="money-liab-amt">{line.amountLabel}</b>
                </Link>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
