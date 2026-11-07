/**
 * Signed-out fixture for Expected money in.
 * Sample rows only. This is not Massair CT and it does not save anything.
 */
import CashHealthView from "@/components/cashhealth/CashHealthView";
import { cashHealthFixture, cashHealthFixtureActions, FIXTURE_TODAY } from "@/lib/cashHealthFixture";
import "@/components/v8/v8.css";

export default function CashHealthPreviewFixture() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-3 pt-3 md:px-6">
        <p data-testid="fixture-label" style={{ margin: 0, padding: "8px 10px", borderRadius: 10, background: "#0F1B2A", color: "#fff", fontSize: 12, fontWeight: 700, position: "sticky", top: 8, zIndex: 30 }}>
          FIXTURE · signed out · not live Massair CT records
        </p>
      </div>
      <CashHealthView data={cashHealthFixture} actions={cashHealthFixtureActions} companyName="Fixture Co" tab="in" today={FIXTURE_TODAY} />
    </div>
  );
}
