import { Route } from "react-router-dom";
import { V8SimpleHome, V8SimpleMe, V8SimpleSoon } from "@/components/v8simple/V8SimpleHome";
import { V8SimpleJob } from "@/components/v8simple/V8SimpleJob";
import { V8SimpleJobs } from "@/components/v8simple/V8SimpleJobs";

/** Child routes shared by /v8 and the dev harness. */
export function v8SimpleChildRoutes() {
  return (
    <>
      <Route index element={<V8SimpleHome />} />
      <Route path="jobs" element={<V8SimpleJobs />} />
      <Route path="jobs/:id" element={<V8SimpleJob />} />
      <Route path="schedule" element={<V8SimpleSoon title="Schedule" line="The week board and Ready to book panel arrive later. Today's schedule page is unchanged." />} />
      <Route path="clients" element={<V8SimpleSoon title="Clients" line="People, sites, and project houses will live here. The clients page is unchanged." />} />
      <Route path="me" element={<V8SimpleMe />} />
    </>
  );
}
