import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Global unhandled error logging with context
window.addEventListener("error", (event) => {
  console.error("[Global] Unhandled error:", {
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    col: event.colno,
    url: window.location.pathname,
    timestamp: new Date().toISOString(),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[Global] Unhandled promise rejection:", {
    reason: event.reason?.message || event.reason,
    stack: event.reason?.stack,
    url: window.location.pathname,
    timestamp: new Date().toISOString(),
  });
});

createRoot(document.getElementById("root")!).render(<App />);
