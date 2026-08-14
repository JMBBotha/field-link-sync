import { forwardRef, type SVGProps } from "react";

/**
 * Rand currency glyph — a bold "R" inside a solid black coin.
 * The dot and light text are the same in both light and dark modes.
 */
const RandSign = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  ({ className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="10.5" fill="black" />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="16"
        fontWeight="bold"
        fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      >
        R
      </text>
    </svg>
  )
);

RandSign.displayName = "RandSign";

export default RandSign;
