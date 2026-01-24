import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { OfflineProvider } from "@/contexts/OfflineContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import AdminDashboard from "./pages/AdminDashboard";
import FieldAgent from "./pages/FieldAgent";
import CustomerPortal from "./pages/CustomerPortal";
import CustomerFeedbackForm from "./components/CustomerFeedbackForm";
import CustomerInvoiceView from "./components/CustomerInvoiceView";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <OfflineProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/field" element={<FieldAgent />} />
            {/* Customer Portal Routes */}
            <Route path="/customer/:token" element={<CustomerPortal />} />
            <Route path="/customer/:token/feedback" element={<CustomerFeedbackForm />} />
            <Route path="/customer/:token/feedback/:leadId" element={<CustomerFeedbackForm />} />
            <Route path="/customer/:token/invoices" element={<CustomerInvoiceView />} />
            <Route path="/customer/:token/invoice/:invoiceId" element={<CustomerInvoiceView />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </OfflineProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
