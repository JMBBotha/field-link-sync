/** /admin/estimates/:id → the ONE quote builder (Johan 09:49). The old estimate page is archived. */
import { Navigate, useLocation, useParams } from "react-router-dom";
export default function EstimateToBuilderRedirect() {
  const { id = "" } = useParams();
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("quoteId", id);
  return <Navigate to={`/admin/quote-builder?${p.toString()}`} replace />;
}
