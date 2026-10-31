import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { hasInAppHistory, isRootPath, parentPath } from "@/lib/backNav";

/** One shared back arrow for every page header (admin, sales, tech, client). Hidden on root tabs. */
export default function BackButton({ className = "" }: { className?: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (isRootPath(pathname)) return null;
  return (
    <button
      type="button"
      data-testid="header-back"
      aria-label="Back"
      onClick={() => (hasInAppHistory() ? navigate(-1) : navigate(parentPath(pathname), { replace: true }))}
      className={`inline-flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/10 hover:text-white active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${className}`}
    >
      <ChevronLeft className="h-6 w-6" />
    </button>
  );
}
