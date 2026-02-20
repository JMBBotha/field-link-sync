import { useState, useCallback, useEffect } from "react";

export interface ExitGuardActions {
  showModal: boolean;
  requestExit: () => void;
  confirmContinue: () => void;
  confirmSaveForLater: () => void;
  confirmDiscard: () => void;
}

/**
 * Manages an unsaved-changes exit guard.
 * - `isDirty`: whether the form has unsaved changes
 * - `onSaveForLater`: async callback to silently save draft
 * - `onDiscard`: callback to clear draft and close
 */
export function useExitGuard({
  isDirty,
  onSaveForLater,
  onDiscard,
}: {
  isDirty: boolean;
  onSaveForLater: () => Promise<void> | void;
  onDiscard: () => void;
}): ExitGuardActions {
  const [showModal, setShowModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<"exit" | null>(null);

  const requestExit = useCallback(() => {
    if (isDirty) {
      setShowModal(true);
    } else {
      onDiscard();
    }
  }, [isDirty, onDiscard]);

  const confirmContinue = useCallback(() => {
    setShowModal(false);
    setPendingAction(null);
  }, []);

  const confirmSaveForLater = useCallback(async () => {
    setShowModal(false);
    await onSaveForLater();
  }, [onSaveForLater]);

  const confirmDiscard = useCallback(() => {
    setShowModal(false);
    onDiscard();
  }, [onDiscard]);

  // Warn on browser navigation (refresh/close tab)
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  return { showModal, requestExit, confirmContinue, confirmSaveForLater, confirmDiscard };
}
