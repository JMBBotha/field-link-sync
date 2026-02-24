import { useState, useCallback, useEffect } from "react";

export interface UnsavedQuoteGuardActions {
  showModal: boolean;
  requestExit: () => void;
  confirmContinue: () => void;
  confirmSaveDraft: () => void;
  confirmSendQuote: () => void;
  confirmDeleteQuote: () => void;
}

/**
 * Extended unsaved-changes guard for quote editors.
 * Supports Save Draft, Send Quote, Delete Quote, and Cancel actions.
 */
export function useUnsavedQuoteGuard({
  isDirty,
  canSave,
  onSaveDraft,
  onSendQuote,
  onDeleteQuote,
  onExit,
}: {
  isDirty: boolean;
  canSave: boolean;
  onSaveDraft: () => Promise<void> | void;
  onSendQuote?: () => Promise<void> | void;
  onDeleteQuote?: () => Promise<void> | void;
  onExit: () => void;
}): UnsavedQuoteGuardActions {
  const [showModal, setShowModal] = useState(false);

  const requestExit = useCallback(() => {
    if (isDirty) {
      setShowModal(true);
    } else {
      onExit();
    }
  }, [isDirty, onExit]);

  const confirmContinue = useCallback(() => {
    setShowModal(false);
  }, []);

  const confirmSaveDraft = useCallback(async () => {
    setShowModal(false);
    await onSaveDraft();
  }, [onSaveDraft]);

  const confirmSendQuote = useCallback(async () => {
    setShowModal(false);
    if (onSendQuote) await onSendQuote();
  }, [onSendQuote]);

  const confirmDeleteQuote = useCallback(async () => {
    setShowModal(false);
    if (onDeleteQuote) await onDeleteQuote();
  }, [onDeleteQuote]);

  // Browser beforeunload guard
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  return {
    showModal,
    requestExit,
    confirmContinue,
    confirmSaveDraft,
    confirmSendQuote,
    confirmDeleteQuote,
  };
}
