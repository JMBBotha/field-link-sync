import RoleMapFrame from "@/components/v8/roleHome/RoleMapFrame";
import { YardLiveHome } from "@/components/v8/roleHome/LiveHomes";

/** Yard view on its own route. Admin Home links here; the sidebar does not. */
export default function AdminYardPage() {
  return (
    <RoleMapFrame>
      <YardLiveHome />
    </RoleMapFrame>
  );
}
