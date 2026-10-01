import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EntityRealtimeSync } from "@/hooks/useEntityRealtimeSync";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { OfflineProvider } from "@/contexts/OfflineContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { MandyActionsProvider } from "@/lib/mandy/registry";
import MandyDock from "@/components/mandy/MandyDock";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import RequireRole from "@/components/RequireRole";
import RequireOwner from "@/components/RequireOwner";
import { OfflineBanner } from "@/components/OfflineBanner";
import VersionBanner from "@/components/VersionBanner";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import FieldAgent from "./pages/FieldAgent";
import CustomerPortal from "./pages/CustomerPortal";
import AdminMoneyPage from "./pages/admin/AdminMoneyPage";
import AdminMyCommissionPage from "./pages/admin/AdminMyCommissionPage";
import FieldEarningsPage from "./pages/FieldEarningsPage";
import CustomerFeedbackForm from "./components/CustomerFeedbackForm";
import CustomerInvoiceView from "./components/CustomerInvoiceView";
import NotFound from "./pages/NotFound";
import UnifiedOnboarding from "./pages/UnifiedOnboarding";
import IndependentSignup from "./pages/IndependentSignup";
import SetPassword from "./pages/SetPassword";
import IdleLogoutGate from "@/components/IdleLogoutGate";
import ClientProposalView from "./components/client/ClientProposalView";


// Admin layout + pages
import AdminLayout from "./components/admin/AdminLayout";
import { AdminHomePage, AdminMapPage, AdminQuotesPage, AdminEstimateDetailPage, AdminProposalsPage, AdminInvoicesPage, AdminImportPage, AdminHelpPage } from "./pages/admin";
import AdminQuoteBuilderPage from "./pages/admin/AdminQuoteBuilderPage";
import AdminQuoteBuilderPageUnified from "./pages/admin/AdminQuoteBuilderPageUnified";
import AdminProposalBuilderPage from "./pages/admin/AdminProposalBuilderPage";
import AdminCatalogPage from "./pages/admin/AdminCatalogPage";
import AdminDispatchPage from "./pages/admin/AdminDispatchPage";
import AdminUnassignedQueuePage from "./pages/admin/AdminUnassignedQueuePage";
import AdminJobsMapPage from "./pages/admin/AdminJobsMapPage";
import AdminMaintenancePage from "./pages/admin/AdminMaintenancePage";
import AdminCustomersPage from "./pages/admin/AdminCustomersPage";
import AdminCustomerDetailPage from "./pages/admin/AdminCustomerDetailPage";
import AdminJobDetailPage from "./pages/admin/AdminJobDetailPage";
import AdminJobsHubPage, { JobsDispatchRedirect } from "./pages/admin/AdminJobsHubPage";
import AdminMyJobsPage from "./pages/admin/AdminMyJobsPage";
import AdminMyAppointmentsPage from "./pages/admin/AdminMyAppointmentsPage";
import AdminPriceListsPage from "./pages/admin/AdminPriceListsPage";
import FieldSchedulePage from "./pages/FieldSchedulePage";
import FieldJobSheetPage from "./pages/FieldJobSheetPage";

// Lazy-loaded admin pages (simple wrappers)
import ScheduleCalendar from "./components/scheduling/ScheduleCalendar";
import InventoryList from "./components/inventory/InventoryList";
import ReportBuilder from "./components/reports/ReportBuilder";
import AnalyticsDashboard from "./components/analytics/AnalyticsDashboard";
import AdminNotificationSettings from "./components/AdminNotificationSettings";
import AdminChangeRequestsPage from "./pages/admin/AdminChangeRequestsPage";
import AuditLogViewer from "./components/audit/AuditLogViewer";
import AdminSettingsPage from "./components/AdminSettingsPage";
import ServiceAgreements from "./components/ServiceAgreements";
import AdminAdvancedReportsPage from "./pages/admin/AdminAdvancedReportsPage";
import AccountsAgingReportPage from "./pages/admin/reports/AccountsAgingReportPage";
import SalesByClientReportPage from "./pages/admin/reports/SalesByClientReportPage";
import SalesByProductReportPage from "./pages/admin/reports/SalesByProductReportPage";
import VatSummaryReportPage from "./pages/admin/reports/VatSummaryReportPage";
import AdminTeamPage from "./pages/admin/AdminTeamPage";

import AdminNetworkAgentsPage from "./pages/admin/AdminNetworkAgentsPage";

import AdminSuppliersPage from "./pages/admin/AdminSuppliersPage";
import AdminConsumablesPage from "./pages/admin/AdminConsumablesPage";
import AdminCallsPage from "./pages/admin/AdminCallsPage";
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
  <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <OfflineProvider>
          <ErrorBoundary>
            <EntityRealtimeSync />
            <OfflineBanner />
            <VersionBanner />
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <MandyActionsProvider>
              <MandyDock />
              <IdleLogoutGate />
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<Index />} />
                <Route path="/login" element={<Auth />} />
                <Route path="/auth" element={<Navigate to="/login" replace />} />
                
                <Route path="/onboarding" element={<UnifiedOnboarding />} />
                <Route path="/signup/independent" element={<IndependentSignup />} />
                <Route path="/set-password" element={<SetPassword />} />

                {/* Customer Portal Routes */}
                <Route path="/customer/:token" element={<CustomerPortal />} />
                <Route path="/customer/:token/feedback" element={<CustomerFeedbackForm />} />
                <Route path="/customer/:token/feedback/:leadId" element={<CustomerFeedbackForm />} />
                <Route path="/customer/:token/invoices" element={<CustomerInvoiceView />} />
                <Route path="/customer/:token/invoice/:invoiceId" element={<CustomerInvoiceView />} />
                <Route path="/quote/:token" element={<ClientProposalView />} />

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

                {/* Protected routes */}
                <Route element={<ProtectedRoute />}>
                  {/* Admin layout with nested routes */}
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<AdminHomePage />} />
                    <Route path="map" element={<RequireRole allowedRoles={["admin","dispatcher","viewer","field_agent"]} denySalesRep><AdminMapPage /></RequireRole>} />
                    <Route path="jobs-map" element={<RequireRole allowedRoles={["admin","dispatcher","viewer","field_agent"]} denySalesRep><AdminJobsMapPage /></RequireRole>} />
                    <Route path="dispatch" element={<AdminDispatchPage />} />
                    <Route path="unassigned-queue" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminUnassignedQueuePage /></RequireRole>} />

                    <Route path="jobs" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} redirectTo="/admin/my-jobs" redirectOnDeny><AdminJobsHubPage /></RequireRole>} />
                    <Route path="jobs/dispatch" element={<JobsDispatchRedirect />} />
                    <Route path="jobs/:id" element={<AdminJobDetailPage />} />
                    <Route path="my-jobs" element={<AdminMyJobsPage />} />
                    <Route path="my-appointments" element={<AdminMyAppointmentsPage />} />
                    <Route path="schedule" element={<ScheduleCalendar />} />
                    <Route path="quotes" element={<AdminQuotesPage />} />
                    <Route path="estimates/:id" element={<AdminEstimateDetailPage />} />

                    <Route path="templates" element={<AdminProposalsPage />} />
                    <Route path="invoices" element={<AdminInvoicesPage />} />
                    <Route path="invoices/:id" element={<AdminInvoicesPage />} />
                    <Route path="money" element={<RequireRole allowedRoles={["admin"]}><RequireOwner><AdminMoneyPage /></RequireOwner></RequireRole>} />
                    <Route path="my-commission" element={<AdminMyCommissionPage />} />
                    <Route path="help" element={<AdminHelpPage />} />

                    
                    <Route path="agreements" element={<ServiceAgreements />} />
                    <Route path="catalog" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminCatalogPage /></RequireRole>} />
                    <Route path="price-lists" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminPriceListsPage /></RequireRole>} />
                    <Route path="maintenance" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminMaintenancePage /></RequireRole>} />
                    <Route path="customers" element={<AdminCustomersPage />} />
                    <Route path="customers/:id" element={<AdminCustomerDetailPage />} />
                    <Route path="inventory" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><InventoryList /></RequireRole>} />
                    <Route path="reports" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><ReportBuilder /></RequireRole>} />
                    <Route path="reports/advanced" element={<RequireRole allowedRoles={["admin"]} denySalesRep><AdminAdvancedReportsPage /></RequireRole>} />
                    <Route path="reports/aging" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><AccountsAgingReportPage /></RequireRole>} />
                    <Route path="reports/sales-by-client" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><SalesByClientReportPage /></RequireRole>} />
                    <Route path="reports/sales-by-product" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><SalesByProductReportPage /></RequireRole>} />
                    <Route path="reports/vat" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><VatSummaryReportPage /></RequireRole>} />
                    <Route path="analytics" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><AnalyticsDashboard /></RequireRole>} />
                    <Route path="notifications" element={<RequireRole allowedRoles={["admin"]}><AdminNotificationSettings /></RequireRole>} />
                    <Route path="change-requests" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminChangeRequestsPage /></RequireRole>} />

                    <Route path="audit" element={<RequireRole allowedRoles={["admin"]}><AuditLogViewer /></RequireRole>} />
                    <Route path="import" element={<RequireRole allowedRoles={["admin"]}><AdminImportPage /></RequireRole>} />
                    <Route path="settings" element={<RequireRole allowedRoles={["admin"]}><AdminSettingsPage /></RequireRole>} />
                    <Route path="team" element={<RequireRole allowedRoles={["admin"]}><AdminTeamPage /></RequireRole>} />
                    <Route path="billing" element={<Navigate to="/admin/invoices" replace />} />
                    <Route path="suppliers" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminSuppliersPage /></RequireRole>} />
                    <Route path="consumables" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminConsumablesPage /></RequireRole>} />
                    {/* WhatsApp quote bot retired — page hidden (the backend function is a no-op behind WHATSAPP_QUOTE_BOT_ENABLED). */}
                    <Route path="whatsapp" element={<Navigate to="/admin" replace />} />
                    <Route path="calls" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminCallsPage /></RequireRole>} />
                    <Route path="pdf-documents" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminPDFDocumentsPage /></RequireRole>} />
                    <Route path="brochures" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminBrochuresPage /></RequireRole>} />
                    <Route path="companies" element={<RequireRole allowedRoles={["admin"]}><CompanyManagement /></RequireRole>} />
                    <Route path="network-agents" element={<RequireRole allowedRoles={["admin"]}><AdminNetworkAgentsPage /></RequireRole>} />
                  </Route>


                  {/* Unified Quote Builder — single source of truth (quote_items + quote_areas). */}
                  <Route path="/admin/proposal-builder" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminProposalBuilderPage /></RequireRole>} />
                  <Route path="/admin/quote-builder" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminQuoteBuilderPageUnified mode="admin" /></RequireRole>} />

                  {/* Agent Quote Builder — same component, agent mode */}
                  <Route path="/field/quote-builder" element={<RequireRole allowedRoles={["admin", "dispatcher"]} redirectTo="/field" redirectOnDeny><AdminQuoteBuilderPageUnified mode="agent" /></RequireRole>} />


                  {/* Field agent My Jobs — accessible without AdminLayout */}
                  <Route path="/field/my-jobs" element={<RequireRole allowedRoles={["field_agent", "admin", "dispatcher"]}><AdminMyJobsPage /></RequireRole>} />

                  {/* Field agent Schedule (agenda view) */}
                  <Route path="/field/schedule" element={<RequireRole allowedRoles={["field_agent", "admin", "dispatcher"]}><FieldSchedulePage /></RequireRole>} />

                  {/* Tech job sheet: no money, packing list from get_job_packing_list */}
                  <Route path="/field/jobs/:id" element={<RequireRole allowedRoles={["field_agent", "admin", "dispatcher"]}><FieldJobSheetPage /></RequireRole>} />

                  {/* Tech "My earnings" (Job 6) */}
                  <Route path="/field/earnings" element={<RequireRole allowedRoles={["field_agent", "admin", "dispatcher"]}><FieldEarningsPage /></RequireRole>} />

                  {/* Field Agent */}
                  <Route path="/field" element={<FieldAgent />} />

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
                </Route>

                {/* Catch-all */}
                <Route path="*" element={<NotFound />} />
              </Routes>
              </MandyActionsProvider>
            </BrowserRouter>
          </ErrorBoundary>
        </OfflineProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </AuthProvider>
);

export default App;
