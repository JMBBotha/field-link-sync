import { v8Rand } from "@/lib/v8simple/jobs";
import { v8RepairDeposit, v8ServiceInvoice } from "@/lib/v8simple/servicePath";

const invoice = v8ServiceInvoice([{ kind: "sales" }, { kind: "tech" }], 180);
const repair = v8RepairDeposit(4000);

/** Book → schedule → on site → call-out invoice, or a part and a repair deposit. */
export function V8SimpleService() {
  return (
    <article data-testid="v8-service-path">
      <p className="rh-eyebrow">Service call-out</p>
      <h1 className="v8s-h1">Demo service</h1>
      <ol>
        <li>Booked as a call-out. The sales site visit is free.</li>
        <li>On the schedule with the other ready work.</li>
        <li>On site: checklist, photos, R410 or R32.</li>
      </ol>
      <section className="rh-card" data-testid="v8-service-invoice">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h2>Invoice</h2>
          {invoice.lines.map((line) => (
            <p key={line.name}>{line.name} · {v8Rand(line.exclVat)} excl. VAT · own line</p>
          ))}
          <p className="rh-muted">Not deducted from the repair or any quote. {invoice.salesVisitsFree} sales visit stays free.</p>
        </div>
      </section>
      <section className="rh-card" data-testid="v8-repair-quote">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h2>Needs a part</h2>
          <p>The office builds a repair quote. Deposit {repair.percent}% is {v8Rand(repair.amount)}.</p>
        </div>
      </section>
    </article>
  );
}
