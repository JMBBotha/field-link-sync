import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { useRole } from "@/hooks/useRole";
import IdleWarningModal from "@/components/IdleWarningModal";

const IdleWatch = ({ enforce }: { enforce: boolean }) => {
  const { showWarning, secondsLeft, stayActive } = useIdleLogout(enforce);
  return <IdleWarningModal open={showWarning} secondsLeft={secondsLeft} onStayActive={stayActive} />;
};

/** 30-min idle logout for ADMINS only (Johan 29 Oct 2026). Sales (dispatcher) and technicians stay signed in on
 *  every page until they tap Sign out; they also ignore idle "logout" broadcasts from an admin tab. /field never logs out. */
export default function IdleLogoutGate() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const { isAdmin, loading } = useRole();
  if (!session) return null;
  return <IdleWatch enforce={!loading && isAdmin && !pathname.startsWith("/field")} />;
}
