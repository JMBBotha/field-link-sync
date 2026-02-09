import { Navigate } from "react-router-dom";

// Legacy component - all admin routing now handled by AdminLayout + nested routes
const AdminDashboard = () => {
  return <Navigate to="/admin" replace />;
};

export default AdminDashboard;
