import { Navigate, useSearchParams } from "react-router-dom";
import V8SimpleShell from "@/components/v8simple/V8SimpleShell";
import { isV8SimpleEnabled, rememberV8Simple, v8SimpleAccess } from "@/lib/v8simple/flag";

/** /v8. Flag off sends people home, so the live app is unchanged. */
export default function V8SimpleGate() {
  const [sp] = useSearchParams();
  rememberV8Simple(sp);
  if (v8SimpleAccess(isV8SimpleEnabled(sp)) === "redirect-home") return <Navigate to="/" replace />;
  return <V8SimpleShell root="/v8" />;
}
