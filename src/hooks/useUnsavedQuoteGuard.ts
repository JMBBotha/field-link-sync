import { useState, useCallback, createElement, type ReactElement } from "react";
import QuoteExitDialog from "@/components/quotes/QuoteExitDialog";

export interface UnsavedQuoteGuardActions {
  showModal: boolean;
  requestExit: () => void;
  confirmContinue: () => void;
  confirmSaveDraft: () => void;
  confirmSendQuote: () => void;
  confirmDeleteQuote: () => void;
  /** Render-ready ExitDialog wired to this guard's state. */
  ExitDialog: ReactElement | null;
}

/**
 * Extended unsaved-changes guard for quote editors.
 * Supports Save Draft, Send Quote, Delete Quote, Associate Client, and Cancel actions.
 *
 * Backwards-compatible: existing callers can keep using `canSave` + their own
 * <UnsavedQuoteDialog />. New callers can pass `hasClient` / `onAssociateClient`
 * and render the bundled `ExitDialog`.
 */
export function useUnsavedQuoteGuard({
  isDirty,
  canSave,
  hasClient,
  onSaveDraft,
  onSendQuote,
  onDeleteQuote,
  onAssociateClient,
  onExit,
}: {
  isDirty: boolean;
  canSave: boolean;
  hasClient?: boolean;
  onSaveDraft: () => Promise<unknown> | void;
  onSendQuote?: () => Promise<unknown> | void;
  onDeleteQuote?: () => Promise<unknown> | void;
  onAssociateClient?: () => void;
  onExit: () => void;
}): UnsavedQuoteGuardActions {
  const [showModal, setShowModal] = useState(false);

  const resolvedHasClient = hasClient ?? canSave;

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
    if (!resolvedHasClient) {
      throw new Error("A client must be associated with the quote before saving.");
    }
    setShowModal(false);
    Promise.resolve(onSaveDraft()).catch(() => {});
  }, [onSaveDraft, resolvedHasClient]);

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

  const ExitDialog: ReactElement | null = onAssociateClient
    ? createElement(QuoteExitDialog, {
        open: showModal,
        hasClient: resolvedHasClient,
        onAssociateClient: () => {
          setShowModal(false);
          onAssociateClient();
        },
        onSaveDraft: () => {
          if (!resolvedHasClient) return;
          setShowModal(false);
          Promise.resolve(onSaveDraft()).catch(() => {});
        },
        onDiscard: () => {
          setShowModal(false);
          onExit();
        },
        // Escape / overlay: stay in the editor rather than losing the basket.
        onDismiss: () => setShowModal(false),
        onDelete: onDeleteQuote
          ? () => {
              setShowModal(false);
              Promise.resolve(onDeleteQuote()).catch(() => {});
            }
          : undefined,
      })
    : null;

  return {
    showModal,
    requestExit,
    confirmContinue,
    confirmSaveDraft,
    confirmSendQuote,
    confirmDeleteQuote,
    ExitDialog,
  };
}
