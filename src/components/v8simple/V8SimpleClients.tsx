import { useState } from "react";
import { houseAttachPlan, type HouseJobRef } from "@/lib/bookJobPath";
import { V8_DEMO_ESTATE_PAYER } from "@/lib/v8simple/clientPay";

const HOUSE = { id: "h12", house_no: "12" };
const CLIENT = "demo-estate";
const JOBS: HouseJobRef[] = [
  { id: "install-12", title: "Installation — Demo Estate House 12", customer_id: CLIENT, job_type: "installation", quote_id: null, lead_id: "L12" },
  { id: "service-12", title: "Service House 12", customer_id: CLIENT, job_type: "service", lead_id: null },
];

export function v8HouseBooking(house = HOUSE, jobs = JOBS, customerId = CLIENT) {
  return houseAttachPlan(house, jobs, customerId);
}

const PEOPLE = [
  { name: "Demo client A", site: "24 Demo Lane", unit: "Lounge midwall" },
  { name: "Demo client E", site: "8 Demo Street", unit: "Bedroom split" },
];

export function V8SimpleClients() {
  const plan = v8HouseBooking();
  const [booked, setBooked] = useState(false);
  return (
    <div data-testid="v8-clients">
      <section className="rh-card">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h1 className="v8s-h1">Clients</h1>
          {PEOPLE.map((person) => (
            <p key={person.name}><strong>{person.name}</strong><br /><span className="rh-muted">{person.site} · {person.unit}</span></p>
          ))}
        </div>
      </section>
      <section className="rh-card" data-testid="v8-houses">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h2>Demo Estate</h2>
          <p>House 12 · one installation job</p>
          <p data-testid="v8-house-payer">Pay link for {V8_DEMO_ESTATE_PAYER.name}. The project payer, not the person in the house.</p>
          <button type="button" className="v8s-next" data-orange="main" data-testid="v8-book-house" onClick={() => setBooked(true)}>Book a job</button>
          {booked && (
            <p data-testid="v8-house-attach">
              {plan.attached ? `Attached to ${plan.job?.id}. No second job.` : "Would open one installation job."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
