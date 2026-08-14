import { forwardRef, type SVGProps } from "react";

/**
 * Rand currency glyph — drop-in replacement for lucide's DollarSign.
 * Uses currentColor and the same 24x24 viewBox / stroke conventions.
 */
const RandSign = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  ({ className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M6 21V3h5a5 5 0 0 1 0 10H6" />
      <path d="M11 13l6 8" />
    </svg>
  )
);

RandSign.displayName = "RandSign";

export default RandSign;
