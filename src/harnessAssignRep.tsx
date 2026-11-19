/** Standalone entry so screenshots do not load the signed-in app shell. */
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import AssignRepHarness from "@/pages/AssignRepHarness";

const params = new URLSearchParams(window.location.search);
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AssignRepHarness />
  </BrowserRouter>,
);
