import { Route } from "react-router-dom";
import { V8SimpleHome, V8SimpleMe, V8SimpleSoon } from "@/components/v8simple/V8SimpleHome";
import { V8SimpleJob } from "@/components/v8simple/V8SimpleJob";
import { V8SimpleJobs } from "@/components/v8simple/V8SimpleJobs";
import { V8SimpleClientPage } from "@/components/v8simple/V8SimpleClient";
import { V8SimpleSchedule } from "@/components/v8simple/V8SimpleSchedule";
import { V8SimpleOnSite } from "@/components/v8simple/V8SimpleOnSite";
import { V8SimpleQuote } from "@/components/v8simple/V8SimpleQuote";

/** Child routes shared by /v8 and the dev harness. */
export function v8SimpleChildRoutes() {
  return (
    <>
      <Route index element={<V8SimpleHome />} />
      <Route path="jobs" element={<V8SimpleJobs />} />
      <Route path="jobs/:id" element={<V8SimpleJob />} />
      <Route path="schedule" element={<V8SimpleSchedule />} />
      <Route path="clients" element={<V8SimpleSoon title="Clients" line="People, sites, and project houses will live here. The clients page is unchanged." />} />
      <Route path="me" element={<V8SimpleMe />} />
      <Route path="on-site" element={<V8SimpleOnSite />} />
      <Route path="quote" element={<V8SimpleQuote />} />
      <Route path="client" element={<V8SimpleClientPage />} />
    </>
  );
}
