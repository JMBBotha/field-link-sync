import { useAuth } from "@/contexts/AuthContext";
import AgentAvailabilityEditor from "@/components/scheduling/AgentAvailabilityEditor";
import StaffBaseControls from "@/components/scheduling/StaffBaseControls";
import FieldShell from "@/components/field/FieldShell";

/** "My hours & base": own home address, working hours, start point and blocked time. No money. */
export default function MyBasePage({ field = false }: { field?: boolean }) {
  const { user } = useAuth();
  const body = user ? (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">
      {!field && <h2 className="text-xl font-semibold">My hours &amp; base</h2>}
      <StaffBaseControls profileId={user.id} self />
      <AgentAvailabilityEditor agentId={user.id} />
    </div>
  ) : null;
  return field ? <FieldShell title="My hours & base" back>{body}</FieldShell> : body;
}
