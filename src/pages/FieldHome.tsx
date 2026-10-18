import { lazy } from "react";
import { useSearchParams } from "react-router-dom";
import { useRole } from "@/hooks/useRole";
import FieldAgent from "./FieldAgent";

const FieldTodayPage = lazy(() => import("./FieldTodayPage"));

/** /field: pure technicians land on Today; admins/office and deep links (?lead=, ?view=) keep the full field view. */
export default function FieldHome() {
  const { isFieldAgent, isAdmin, isDispatcher, loading } = useRole() as any;
  const [sp] = useSearchParams();
  const deep = [...sp.keys()].length > 0;
  if (loading) return null;
  if (isFieldAgent && !isAdmin && !isDispatcher && !deep) return <FieldTodayPage />;
  return <FieldAgent />;
}
