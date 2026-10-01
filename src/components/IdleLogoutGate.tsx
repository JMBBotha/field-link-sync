import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import IdleWarningModal from "@/components/IdleWarningModal";

const IdleWatch = ({ enforce }: { enforce: boolean }) => {
  const { showWarning, secondsLeft, stayActive } = useIdleLogout(enforce);
  return <IdleWarningModal open={showWarning} secondsLeft={secondsLeft} onStayActive={stayActive} />;
};

/** App-wide idle logout for signed-in users. /field counts as activity but never logs out (live tracking). */
export default function IdleLogoutGate() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  return session ? <IdleWatch enforce={!pathname.startsWith("/field")} /> : null;
}
