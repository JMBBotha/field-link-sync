import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { previewClickOpensChoice } from "@/lib/documentPreviewChoices";

/**
 * Makes a document preview open a choice when the empty page is tapped.
 * Clicks on links, buttons and fields inside the preview are left alone.
 * The surface itself is in the tab order; Enter or Space on it opens the choice.
 */
export default function PreviewClickSurface({
  enabled,
  label,
  onOpen,
  testId = "document-preview-surface",
  children,
}: {
  enabled: boolean;
  label: string;
  onOpen: () => void;
  testId?: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (previewClickOpensChoice(event.target, event.currentTarget)) onOpen();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };
  return (
    <div
      data-testid={testId}
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#3D9BEB] focus-visible:ring-offset-2"
    >
      <span className="sr-only">{label}. Press Enter for options.</span>
      {children}
    </div>
  );
}
