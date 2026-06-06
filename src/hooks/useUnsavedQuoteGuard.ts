import { useState, useCallback } from "react";

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

  const confirmSaveDraft = useCallback(() => {
    setShowModal(false);
    Promise.resolve(onSaveDraft()).catch(() => {});
  }, [onSaveDraft]);

  const confirmSendQuote = useCallback(() => {
    setShowModal(false);
    if (onSendQuote) {
      Promise.resolve(onSendQuote()).catch(() => {});
    }
  }, [onSendQuote]);

  const confirmDeleteQuote = useCallback(() => {
    setShowModal(false);
    if (onDeleteQuote) {
      Promise.resolve(onDeleteQuote()).catch(() => {});
    }
  }, [onDeleteQuote]);

  return {
    showModal,
    requestExit,
    confirmContinue,
    confirmSaveDraft,
    confirmSendQuote,
    confirmDeleteQuote,
  };
}
