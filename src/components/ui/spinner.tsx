import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpinnerProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

const SIZES = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-8 w-8",
};

/** Consistent app-wide spinner. Use inside buttons or standalone. */
export const Spinner = ({ className, size = "sm" }: SpinnerProps) => (
  <Loader2 className={cn(SIZES[size], "animate-spin", className)} />
);

interface LoadingSectionProps {
  label?: string;
  className?: string;
  size?: SpinnerProps["size"];
}

/** Centered spinner + label for section/page loading. */
export const LoadingSection = ({
  label = "Loading…",
  className,
  size = "md",
}: LoadingSectionProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground",
      className,
    )}
  >
    <Spinner size={size} className="text-primary" />
    {label && <p className="text-sm">{label}</p>}
  </div>
);

export default Spinner;
