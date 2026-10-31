import "./index.css";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import V8RoleHome from "@/components/v8/V8RoleHome";
const linked = new URLSearchParams(location.search).get("linked") !== "0";
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
const A = "admin-demo";
const q = (n: number, num: string, status: string, total: number, extra: any = {}) => ({ id: `q${n}`, company_id: "co", status, total, created_at: "2026-10-10T08:00:00Z", sent_at: status !== "draft" ? "2026-10-12T08:00:00Z" : null, viewed_at: ["viewed", "accepted"].includes(status) ? "2026-10-13T08:00:00Z" : null, accepted_at: status === "accepted" ? "2026-10-20T08:00:00Z" : null, declined_at: null, updated_at: "2026-10-20T08:00:00Z", valid_until: "2026-11-30", lead_id: null, sales_engineer_id: A, quote_number: num, option_group_id: null, option_chosen_id: null, customer_name: `Demo Client ${n}`, customers: null, ...extra });
qc.setQueryData(["my-linked-admin", undefined], linked ? A : null);
qc.setQueryData(["pipeline"], {
  quotes: [q(1, "Q-D-001", "draft", 39000), q(2, "Q-D-002", "draft", 82000), q(3, "Q-D-003", "viewed", 819000), q(4, "Q-D-004", "accepted", 9350), q(5, "Q-D-005", "accepted", 28600), q(6, "Q-D-006", "accepted", 21400), q(7, "Q-D-007", "accepted", 14000)],
  invoices: [{ quote_id: "q4", status: "paid", notes: "", grand_total: 9350 }, { quote_id: "q5", status: "partially_paid", notes: "", grand_total: 28600 }, { quote_id: "q6", status: "partially_paid", notes: "", grand_total: 21400 }],
  jobs: [{ quote_id: "q4", status: "scheduled", created_at: "2026-10-21T08:00:00Z" }, { quote_id: "q5", status: "scheduled", created_at: "2026-10-21T08:00:00Z" }, { quote_id: "q6", status: "completed", created_at: "2026-10-27T08:00:00Z" }],
  leads: [], laneByLead: {}, repName: { [A]: "Demo Admin" },
});
createRoot(document.getElementById("root")!).render(<BrowserRouter><QueryClientProvider client={qc}><AuthProvider><div className="p-4"><V8RoleHome role="sales" /></div></AuthProvider></QueryClientProvider></BrowserRouter>);
