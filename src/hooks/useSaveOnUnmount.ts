import { useEffect, useRef } from "react";

/**
 * Saves a pending edit when the field unmounts mid-edit (dialog closed, Esc on the dialog, navigation),
 * so edits are never thrown away silently. `pending` returns the value to save, or undefined for nothing.
 */
export function useSaveOnUnmount<T>(pending: () => T | undefined, save: (v: T) => unknown) {
  const ref = useRef({ pending, save });
  ref.current = { pending, save };
  useEffect(
    () => () => {
      const v = ref.current.pending();
      if (v !== undefined) Promise.resolve(ref.current.save(v)).catch(() => {});
    },
    [],
  );
}
