import { lazy, Suspense } from "react";
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
import SalesRepFieldRedirect from "@/components/SalesRepFieldRedirect";
import RequireOwner from "@/components/RequireOwner";
import RequirePlatformOwner from "@/components/RequirePlatformOwner";
import { OfflineBanner } from "@/components/OfflineBanner";
import VersionBanner from "@/components/VersionBanner";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import FieldAgent from "./pages/FieldAgent";
import NotFound from "./pages/NotFound";
import IdleLogoutGate from "@/components/IdleLogoutGate";


// Admin layout + pages
import { AdminHomePage, AdminMapPage, AdminQuotesPage, AdminEstimateDetailPage, AdminProposalsPage, AdminInvoicesPage, AdminImportPage, AdminHelpPage } from "./pages/admin";
import AdminJobsHubPage, { JobsDispatchRedirect, DispatchCalendarRedirect } from "./pages/admin/AdminJobsHubPage";
import { AdminVisitsPage, AdminVisitDetailPage } from "./pages/admin/AdminVisitsPage";

// Lazy-loaded admin pages (simple wrappers)



// FreshBooks multi-tenant
import { CompanyProvider } from "./providers/CompanyProvider";
const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));
const AdminMoneyPage = lazy(() => import("./pages/admin/AdminMoneyPage"));
const AdminMyCommissionPage = lazy(() => import("./pages/admin/AdminMyCommissionPage"));
const MySignaturePage = lazy(() => import("./pages/admin/MySignaturePage"));
const FieldEarningsPage = lazy(() => import("./pages/FieldEarningsPage"));
const CustomerFeedbackForm = lazy(() => import("./components/CustomerFeedbackForm"));
const CustomerInvoiceView = lazy(() => import("./components/CustomerInvoiceView"));
const UnifiedOnboarding = lazy(() => import("./pages/UnifiedOnboarding"));
const IndependentSignup = lazy(() => import("./pages/IndependentSignup"));
const SetPassword = lazy(() => import("./pages/SetPassword"));
const ClientProposalView = lazy(() => import("./components/client/ClientProposalView"));
const UnitBrochurePage = lazy(() => import("./pages/public/UnitBrochurePage"));
const PublicStatement = lazy(() => import("./pages/PublicStatement"));
const AdminExpensesPage = lazy(() => import("./pages/admin/AdminExpensesPage"));
const AdminBankPage = lazy(() => import("./pages/admin/AdminBankPage"));
const AdminSupplierBillsPage = lazy(() => import("./pages/admin/AdminSupplierBillsPage"));
const AdminPaymentFollowupsPage = lazy(() => import("./pages/admin/AdminPaymentFollowupsPage"));
const AdminCompanyPlansPage = lazy(() => import("./pages/admin/AdminCompanyPlansPage"));
const AdminCashflowPage = lazy(() => import("./pages/admin/AdminCashflowPage"));
const AdminLayout = lazy(() => import("./components/admin/AdminLayout"));
const MyBasePage = lazy(() => import("./pages/MyBasePage"));
const AdminQuoteBuilderPageUnified = lazy(() => import("./pages/admin/AdminQuoteBuilderPageUnified"));
import LegacyBuilderRedirect from "./components/routing/LegacyBuilderRedirect";
const AdminCatalogPage = lazy(() => import("./pages/admin/AdminCatalogPage"));
const AdminUnassignedQueuePage = lazy(() => import("./pages/admin/AdminUnassignedQueuePage"));
const AdminJobsMapPage = lazy(() => import("./pages/admin/AdminJobsMapPage"));
const AdminMaintenancePage = lazy(() => import("./pages/admin/AdminMaintenancePage"));
const AdminCustomersPage = lazy(() => import("./pages/admin/AdminCustomersPage"));
const AdminCustomerDetailPage = lazy(() => import("./pages/admin/AdminCustomerDetailPage"));
const AdminJobDetailPage = lazy(() => import("./pages/admin/AdminJobDetailPage"));
const AdminMyJobsPage = lazy(() => import("./pages/admin/AdminMyJobsPage"));
const AdminMyAppointmentsPage = lazy(() => import("./pages/admin/AdminMyAppointmentsPage"));
const AdminPriceListsPage = lazy(() => import("./pages/admin/AdminPriceListsPage"));
const AdminOssExtrasPage = lazy(() => import("./pages/admin/AdminOssExtrasPage"));
const FieldSchedulePage = lazy(() => import("./pages/FieldSchedulePage"));
const FieldJobSheetPage = lazy(() => import("./pages/FieldJobSheetPage"));
const InventoryList = lazy(() => import("./components/inventory/InventoryList"));
const ReportBuilder = lazy(() => import("./components/reports/ReportBuilder"));
const AnalyticsDashboard = lazy(() => import("./components/analytics/AnalyticsDashboard"));
const AdminNotificationSettings = lazy(() => import("./components/AdminNotificationSettings"));
const AdminChangeRequestsPage = lazy(() => import("./pages/admin/AdminChangeRequestsPage"));
const AuditLogViewer = lazy(() => import("./components/audit/AuditLogViewer"));
const AdminSettingsPage = lazy(() => import("./components/AdminSettingsPage"));
const ServiceAgreements = lazy(() => import("./components/ServiceAgreements"));
const AdminAdvancedReportsPage = lazy(() => import("./pages/admin/AdminAdvancedReportsPage"));
const AccountsAgingReportPage = lazy(() => import("./pages/admin/reports/AccountsAgingReportPage"));
const SalesByClientReportPage = lazy(() => import("./pages/admin/reports/SalesByClientReportPage"));
const SalesByProductReportPage = lazy(() => import("./pages/admin/reports/SalesByProductReportPage"));
const VatSummaryReportPage = lazy(() => import("./pages/admin/reports/VatSummaryReportPage"));
const AdminTeamPage = lazy(() => import("./pages/admin/AdminTeamPage"));
const AdminAreasPage = lazy(() => import("./pages/admin/AdminAreasPage"));
const AdminSuppliersPage = lazy(() => import("./pages/admin/AdminSuppliersPage"));
const AdminSpecialsPage = lazy(() => import("./pages/admin/AdminSpecialsPage"));
const AdminConsumablesPage = lazy(() => import("./pages/admin/AdminConsumablesPage"));
const AdminCallsPage = lazy(() => import("./pages/admin/AdminCallsPage"));
const AdminPDFDocumentsPage = lazy(() => import("./pages/admin/AdminPDFDocumentsPage"));
const AdminBrochuresPage = lazy(() => import("./pages/admin/AdminBrochuresPage"));
const AdminUnitContentPage = lazy(() => import("./pages/admin/AdminUnitContentPage"));
const FBLayout = lazy(() => import("./components/freshbooks/FBLayout"));
const FBDashboard = lazy(() => import("./components/freshbooks/FBDashboard"));
const FBInvoiceList = lazy(() => import("./components/freshbooks/FBInvoiceList"));
const FBEstimatesList = lazy(() => import("./components/freshbooks/FBEstimatesList"));
const FBExpensesList = lazy(() => import("./components/freshbooks/FBExpensesList"));
const FBTimeTracking = lazy(() => import("./components/freshbooks/FBTimeTracking"));
const FBContactsList = lazy(() => import("./components/freshbooks/FBContactsList"));
const FBReports = lazy(() => import("./components/freshbooks/FBReports"));
const FBPaymentsList = lazy(() => import("./components/freshbooks/FBPaymentsList"));
const FBClientPortal = lazy(() => import("./components/freshbooks/FBClientPortal"));
const FBProjectsList = lazy(() => import("./components/freshbooks/FBProjectsList"));
const CompanyManagement = lazy(() => import("./components/freshbooks/CompanyManagement"));
const FBCreateInvoicePage = lazy(() => import("./pages/FBCreateInvoicePage"));

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
              <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Loading…</div>}>
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
                <Route path="/u/:modelKey" element={<UnitBrochurePage />} />
                <Route path="/statement/:token" element={<PublicStatement />} />

                {/* Archived FreshBooks copy (accounting step 0): admins only; the live accounting is /admin/invoices. */}
                <Route path="/client/:companyId" element={<RequireRole allowedRoles={["admin"]} denySalesRep><RequirePlatformOwner><CompanyProvider><FBLayout /></CompanyProvider></RequirePlatformOwner></RequireRole>}>
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
                  <Route path="estimates/new" element={<LegacyBuilderRedirect />} />
                  <Route path="portal" element={<FBClientPortal />} />
                  <Route path="audit" element={<AuditLogViewer />} />
                </Route>

                {/* Full-page Quote Builder for client portal (outside FBLayout for full-bleed) */}
                {/* Legacy client-portal builder archived (src/pages/FBQuoteBuilderPage.tsx kept): every role uses the one current builder. */}
                <Route path="/client/:companyId/quote-builder" element={<Navigate to="/admin/quote-builder" replace />} />

                {/* Protected routes */}
                <Route element={<ProtectedRoute />}>
                  {/* Admin layout with nested routes */}
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<AdminHomePage />} />
                    <Route path="map" element={<RequireRole allowedRoles={["admin","dispatcher","viewer","field_agent"]} denySalesRep><AdminMapPage /></RequireRole>} />
                    <Route path="jobs-map" element={<RequireRole allowedRoles={["admin","dispatcher","viewer","field_agent"]} denySalesRep><AdminJobsMapPage /></RequireRole>} />
                    {/* Dispatch calendar + old Schedule now live in Jobs → Dispatch · Calendar (hub role check applies); params kept. */}
                    <Route path="dispatch" element={<DispatchCalendarRedirect />} />
                    <Route path="unassigned-queue" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminUnassignedQueuePage /></RequireRole>} />

                    <Route path="jobs" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} redirectTo="/admin/my-jobs" redirectOnDeny><AdminJobsHubPage /></RequireRole>} />
                    <Route path="jobs/dispatch" element={<JobsDispatchRedirect />} />
                    <Route path="jobs/:id" element={<AdminJobDetailPage />} />
                    <Route path="my-jobs" element={<AdminMyJobsPage />} />
                    <Route path="my-base" element={<MyBasePage />} />
                    <Route path="my-appointments" element={<AdminMyAppointmentsPage />} />
                    <Route path="visits" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminVisitsPage /></RequireRole>} />
                    <Route path="visits/:leadId" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminVisitDetailPage /></RequireRole>} />
                    <Route path="schedule" element={<DispatchCalendarRedirect />} />
                    <Route path="quotes" element={<AdminQuotesPage />} />
                    <Route path="estimates/:id" element={<AdminEstimateDetailPage />} />

                    <Route path="templates" element={<AdminProposalsPage />} />
                    <Route path="invoices" element={<AdminInvoicesPage />} />
                    <Route path="invoices/:id" element={<AdminInvoicesPage />} />
                    <Route path="expenses" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminExpensesPage /></RequireRole>} />
                    <Route path="bank" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminBankPage /></RequireRole>} />
                    <Route path="payment-followups" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminPaymentFollowupsPage /></RequireRole>} />
                    <Route path="company-plans" element={<RequireRole allowedRoles={["admin"]} denySalesRep><AdminCompanyPlansPage /></RequireRole>} />
                    <Route path="supplier-bills" element={<RequireRole allowedRoles={["admin"]} denySalesRep><AdminSupplierBillsPage /></RequireRole>} />
                    <Route path="cashflow" element={<RequireRole allowedRoles={["admin"]} denySalesRep><AdminCashflowPage /></RequireRole>} />
                    <Route path="money" element={<RequireRole allowedRoles={["admin"]}><RequireOwner><AdminMoneyPage /></RequireOwner></RequireRole>} />
                    <Route path="my-commission" element={<AdminMyCommissionPage />} />
                    <Route path="my-signature" element={<MySignaturePage />} />
                    <Route path="help" element={<AdminHelpPage />} />

                    
                    <Route path="agreements" element={<ServiceAgreements />} />
                    <Route path="catalog" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminCatalogPage /></RequireRole>} />
                    <Route path="price-lists" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminPriceListsPage /></RequireRole>} />
                    <Route path="oss-extras" element={<RequireRole allowedRoles={["admin"]}><AdminOssExtrasPage /></RequireRole>} />
                    <Route path="maintenance" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminMaintenancePage /></RequireRole>} />
                    <Route path="customers" element={<AdminCustomersPage />} />
                    <Route path="customers/:id" element={<AdminCustomerDetailPage />} />
                    <Route path="inventory" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><InventoryList /></RequireRole>} />
                    <Route path="reports" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><ReportBuilder /></RequireRole>} />
                    <Route path="reports/advanced" element={<RequireRole allowedRoles={["admin"]} denySalesRep><RequirePlatformOwner><AdminAdvancedReportsPage /></RequirePlatformOwner></RequireRole>} />
                    <Route path="reports/aging" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><AccountsAgingReportPage /></RequireRole>} />
                    <Route path="reports/sales-by-client" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><SalesByClientReportPage /></RequireRole>} />
                    <Route path="reports/sales-by-product" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><SalesByProductReportPage /></RequireRole>} />
                    <Route path="reports/vat" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><VatSummaryReportPage /></RequireRole>} />
                    <Route path="analytics" element={<RequireRole allowedRoles={["admin", "dispatcher", "viewer"]} denySalesRep><AnalyticsDashboard /></RequireRole>} />
                    <Route path="notifications" element={<RequireRole allowedRoles={["admin"]}><AdminNotificationSettings /></RequireRole>} />
                    <Route path="change-requests" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminChangeRequestsPage /></RequireRole>} />

                    <Route path="audit" element={<RequireRole allowedRoles={["admin"]}><RequirePlatformOwner><AuditLogViewer /></RequirePlatformOwner></RequireRole>} />
                    <Route path="import" element={<RequireRole allowedRoles={["admin"]}><RequirePlatformOwner><AdminImportPage /></RequirePlatformOwner></RequireRole>} />
                    <Route path="settings" element={<RequireRole allowedRoles={["admin"]}><AdminSettingsPage /></RequireRole>} />
                    <Route path="team" element={<RequireRole allowedRoles={["admin"]}><AdminTeamPage /></RequireRole>} />
                    <Route path="areas" element={<RequireRole allowedRoles={["admin"]} denySalesRep><AdminAreasPage /></RequireRole>} />
                    <Route path="billing" element={<Navigate to="/admin/invoices" replace />} />
                    <Route path="specials" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminSpecialsPage /></RequireRole>} />
                    <Route path="suppliers" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminSuppliersPage /></RequireRole>} />
                    <Route path="consumables" element={<RequireRole allowedRoles={["admin", "dispatcher"]} denySalesRep><AdminConsumablesPage /></RequireRole>} />
                    {/* WhatsApp quote bot retired — page hidden (the backend function is a no-op behind WHATSAPP_QUOTE_BOT_ENABLED). */}
                    <Route path="whatsapp" element={<Navigate to="/admin" replace />} />
                    <Route path="calls" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminCallsPage /></RequireRole>} />
                    <Route path="pdf-documents" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminPDFDocumentsPage /></RequireRole>} />
                    <Route path="brochures" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminBrochuresPage /></RequireRole>} />
                    <Route path="unit-content" element={<RequireRole allowedRoles={["admin"]} denySalesRep><RequirePlatformOwner><AdminUnitContentPage /></RequirePlatformOwner></RequireRole>} />
                    <Route path="companies" element={<RequireRole allowedRoles={["admin"]}><RequirePlatformOwner><CompanyManagement /></RequirePlatformOwner></RequireRole>} />
                    <Route path="network-agents" element={<Navigate to="/admin/team?tab=applications" replace />} />
                  </Route>


                  {/* Unified Quote Builder — single source of truth (quote_items + quote_areas). */}
                  <Route path="/admin/proposal-builder" element={<LegacyBuilderRedirect />} />
                  <Route path="/admin/quote-builder" element={<RequireRole allowedRoles={["admin", "dispatcher"]}><AdminQuoteBuilderPageUnified mode="admin" /></RequireRole>} />

                  {/* Agent Quote Builder — same component, agent mode */}
                  <Route path="/field/quote-builder" element={<SalesRepFieldRedirect><RequireRole allowedRoles={["admin", "dispatcher"]} redirectTo="/field" redirectOnDeny><AdminQuoteBuilderPageUnified mode="agent" /></RequireRole></SalesRepFieldRedirect>} />


                  {/* Field agent My Jobs — accessible without AdminLayout */}
                  <Route path="/field/my-jobs" element={<SalesRepFieldRedirect><RequireRole allowedRoles={["field_agent", "admin", "dispatcher"]}><AdminMyJobsPage /></RequireRole></SalesRepFieldRedirect>} />

                  {/* Field agent Schedule (agenda view) */}
                  <Route path="/field/my-base" element={<SalesRepFieldRedirect><RequireRole allowedRoles={["field_agent", "admin", "dispatcher"]}><MyBasePage field /></RequireRole></SalesRepFieldRedirect>} />
                  <Route path="/field/schedule" element={<SalesRepFieldRedirect><RequireRole allowedRoles={["field_agent", "admin", "dispatcher"]}><FieldSchedulePage /></RequireRole></SalesRepFieldRedirect>} />

                  {/* Tech job sheet: no money, packing list from get_job_packing_list */}
                  <Route path="/field/jobs/:id" element={<RequireRole allowedRoles={["field_agent", "admin", "dispatcher"]}><FieldJobSheetPage /></RequireRole>} />

                  {/* Tech "My earnings" (Job 6) */}
                  <Route path="/field/earnings" element={<RequireRole allowedRoles={["field_agent", "admin"]}><FieldEarningsPage /></RequireRole>} />

                  {/* Field Agent — technicians (and admins/office). Sales reps go to My visits (SalesRepFieldRedirect). */}
                  <Route path="/field" element={<SalesRepFieldRedirect><FieldAgent /></SalesRepFieldRedirect>} />

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
              </Suspense>
              </MandyActionsProvider>
            </BrowserRouter>
          </ErrorBoundary>
        </OfflineProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </AuthProvider>
);

export default App;
