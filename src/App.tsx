import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { OfflineProvider } from "@/contexts/OfflineContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import RequireRole from "@/components/RequireRole";
import { OfflineBanner } from "@/components/OfflineBanner";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import FieldAgent from "./pages/FieldAgent";
import CustomerPortal from "./pages/CustomerPortal";
import CustomerFeedbackForm from "./components/CustomerFeedbackForm";
import CustomerInvoiceView from "./components/CustomerInvoiceView";
import NotFound from "./pages/NotFound";
import UnifiedOnboarding from "./pages/UnifiedOnboarding";
import IndependentSignup from "./pages/IndependentSignup";
import ClientProposalView from "./components/client/ClientProposalView";

// Admin layout + pages
import AdminLayout from "./components/admin/AdminLayout";
import { AdminHomePage, AdminMapPage, AdminQuotesPage, AdminProposalsPage, AdminInvoicesPage, AdminImportPage } from "./pages/admin";
import AdminQuoteBuilderPage from "./pages/admin/AdminQuoteBuilderPage";
import AdminQuoteBuilderPageUnified from "./pages/admin/AdminQuoteBuilderPageUnified";
import AdminCatalogPage from "./pages/admin/AdminCatalogPage";
import AdminDispatchPage from "./pages/admin/AdminDispatchPage";
import AdminMaintenancePage from "./pages/admin/AdminMaintenancePage";
import AdminCustomersPage from "./pages/admin/AdminCustomersPage";
import AdminCustomerDetailPage from "./pages/admin/AdminCustomerDetailPage";

// Lazy-loaded admin pages (simple wrappers)
import ScheduleCalendar from "./components/scheduling/ScheduleCalendar";
import InventoryList from "./components/inventory/InventoryList";
import FlatRateBook from "./components/flatrate/FlatRateBook";
import ReportBuilder from "./components/reports/ReportBuilder";
import AnalyticsDashboard from "./components/analytics/AnalyticsDashboard";
import AdminNotificationSettings from "./components/AdminNotificationSettings";
import AuditLogViewer from "./components/audit/AuditLogViewer";
import AdminSettingsPage from "./components/AdminSettingsPage";
import ServiceAgreements from "./components/ServiceAgreements";
import AdminAdvancedReportsPage from "./pages/admin/AdminAdvancedReportsPage";
import AdminTeamPage from "./pages/admin/AdminTeamPage";
import AdminBillingPage from "./pages/admin/AdminBillingPage";
import AdminNetworkAgentsPage from "./pages/admin/AdminNetworkAgentsPage";

import AdminSuppliersPage from "./pages/admin/AdminSuppliersPage";
import AdminConsumablesPage from "./pages/admin/AdminConsumablesPage";
import AdminWhatsAppPage from "./pages/admin/AdminWhatsAppPage";
import AdminPDFDocumentsPage from "./pages/admin/AdminPDFDocumentsPage";
import AdminBrochuresPage from "./pages/admin/AdminBrochuresPage";

// FreshBooks multi-tenant
import { CompanyProvider } from "./providers/CompanyProvider";
import FBLayout from "./components/freshbooks/FBLayout";
import FBDashboard from "./components/freshbooks/FBDashboard";
import FBInvoiceList from "./components/freshbooks/FBInvoiceList";
import FBEstimatesList from "./components/freshbooks/FBEstimatesList";
import FBExpensesList from "./components/freshbooks/FBExpensesList";
import FBTimeTracking from "./components/freshbooks/FBTimeTracking";
import FBContactsList from "./components/freshbooks/FBContactsList";
import FBReports from "./components/freshbooks/FBReports";
import FBPaymentsList from "./components/freshbooks/FBPaymentsList";
import FBClientPortal from "./components/freshbooks/FBClientPortal";
import FBProjectsList from "./components/freshbooks/FBProjectsList";
import CompanyManagement from "./components/freshbooks/CompanyManagement";
import FBCreateInvoicePage from "./pages/FBCreateInvoicePage";
import FBCreateEstimatePage from "./pages/FBCreateEstimatePage";
import FBQuoteBuilderPage from "./pages/FBQuoteBuilderPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors (auth, not found, etc.)
        if (error?.status >= 400 && error?.status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <OfflineProvider>
        <ErrorBoundary>
          <OfflineBanner />
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Auth />} />
              <Route path="/auth" element={<Navigate to="/login" replace />} />
              <Route path="/onboarding" element={<UnifiedOnboarding />} />
              <Route path="/signup/independent" element={<IndependentSignup />} />

              {/* Admin layout with nested routes */}
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminHomePage />} />
                <Route path="map" element={<AdminMapPage />} />
                <Route path="dispatch" element={<AdminDispatchPage />} />
                <Route path="schedule" element={<ScheduleCalendar />} />
                <Route path="quotes" element={<AdminQuotesPage />} />
                <Route path="templates" element={<AdminProposalsPage />} />
                <Route path="invoices" element={<AdminInvoicesPage />} />
                
                <Route path="agreements" element={<ServiceAgreements />} />
                <Route path="catalog" element={<AdminCatalogPage />} />
                <Route path="maintenance" element={<AdminMaintenancePage />} />
                <Route path="customers" element={<AdminCustomersPage />} />
                <Route path="customers/:id" element={<AdminCustomerDetailPage />} />
                <Route path="inventory" element={<InventoryList />} />
                <Route path="flat-rate" element={<FlatRateBook />} />
                <Route path="reports" element={<ReportBuilder />} />
                <Route path="reports/advanced" element={<AdminAdvancedReportsPage />} />
                <Route path="analytics" element={<AnalyticsDashboard />} />
                <Route path="notifications" element={<AdminNotificationSettings />} />
                <Route path="audit" element={<AuditLogViewer />} />
                <Route path="import" element={<AdminImportPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
                <Route path="team" element={<AdminTeamPage />} />
                <Route path="billing" element={<AdminBillingPage />} />
                <Route path="suppliers" element={<AdminSuppliersPage />} />
                <Route path="consumables" element={<AdminConsumablesPage />} />
                <Route path="whatsapp" element={<AdminWhatsAppPage />} />
                <Route path="pdf-documents" element={<AdminPDFDocumentsPage />} />
                <Route path="brochures" element={<AdminBrochuresPage />} />
                <Route path="companies" element={<CompanyManagement />} />
                <Route path="network-agents" element={<AdminNetworkAgentsPage />} />
              </Route>
              </Route>

              {/* Full-page Quote Builder (outside AdminLayout for full-bleed) */}
              <Route path="/admin/quote-builder" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><FBQuoteBuilderPage mode="admin" /></RequireRole>} />

              {/* Agent Quote Builder — same component, agent mode */}
              <Route path="/field/quote-builder" element={<RequireRole allowedRoles={["admin", "dispatcher", "field_agent"]}><FBQuoteBuilderPage mode="agent" /></RequireRole>} />

              {/* FreshBooks multi-tenant client dashboards */}
              <Route path="/client/:companyId" element={<CompanyProvider><FBLayout /></CompanyProvider>}>
                <Route path="dashboard" element={<FBDashboard />} />
                <Route path="invoices" element={<FBInvoiceList />} />
                <Route path="estimates" element={<FBEstimatesList />} />
                <Route path="expenses" element={<FBExpensesList />} />
                <Route path="time-tracking" element={<FBTimeTracking />} />
                <Route path="clients" element={<FBContactsList />} />
                <Route path="reports" element={<FBReports />} />
                <Route path="payments" element={<FBPaymentsList />} />
                <Route path="projects" element={<FBProjectsList />} />
                <Route path="invoices/new" element={<FBCreateInvoicePage />} />
                <Route path="estimates/new" element={<FBCreateEstimatePage />} />
                <Route path="portal" element={<FBClientPortal />} />
                <Route path="audit" element={<AuditLogViewer />} />
              </Route>

              {/* Full-page Quote Builder for client portal (outside FBLayout for full-bleed) */}
              <Route path="/client/:companyId/quote-builder" element={<CompanyProvider><FBQuoteBuilderPage /></CompanyProvider>} />

              {/* Redirects from old standalone routes */}
              <Route path="/invoices" element={<Navigate to="/admin/invoices" replace />} />
              <Route path="/invoices/:id" element={<Navigate to="/admin/invoices" replace />} />
              <Route path="/quotes" element={<Navigate to="/admin/quotes" replace />} />
              <Route path="/quotes/:id" element={<Navigate to="/admin/quotes" replace />} />
              <Route path="/proposals" element={<Navigate to="/admin/templates" replace />} />
              <Route path="/proposals/:id" element={<Navigate to="/admin/templates" replace />} />
              <Route path="/admin/proposals" element={<Navigate to="/admin/templates" replace />} />
              <Route path="/map" element={<Navigate to="/admin/map" replace />} />
              <Route path="/schedule" element={<Navigate to="/admin/schedule" replace />} />
              <Route path="/inventory" element={<Navigate to="/admin/inventory" replace />} />
              <Route path="/agreements" element={<Navigate to="/admin/agreements" replace />} />
              <Route path="/reports" element={<Navigate to="/admin/reports" replace />} />
              <Route path="/flat-rate" element={<Navigate to="/admin/flat-rate" replace />} />

              {/* Field Agent */}
              <Route path="/field" element={<FieldAgent />} />

              {/* Customer Portal Routes */}
              <Route path="/customer/:token" element={<CustomerPortal />} />
              <Route path="/customer/:token/feedback" element={<CustomerFeedbackForm />} />
              <Route path="/customer/:token/feedback/:leadId" element={<CustomerFeedbackForm />} />
              <Route path="/customer/:token/invoices" element={<CustomerInvoiceView />} />
              <Route path="/customer/:token/invoice/:invoiceId" element={<CustomerInvoiceView />} />
              <Route path="/quote/:token" element={<ClientProposalView />} />

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </OfflineProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
