const STORAGE_KEY = "notif-followup-done";

/** Notification types that require the user to open the linked record first. */
export const requiresFollowUp = (type: string): boolean => {
  const t = (type || "").toLowerCase();
  return (
    t.includes("quote") ||
    t.includes("estimate") ||
    t.includes("proposal") ||
    t.includes("invoice") ||
    t.includes("payment") ||
    t.includes("job") ||
    t.includes("assignment") ||
    t.includes("dispatch") ||
    t.includes("lead")
  );
};

const readSet = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
};

export const getFollowUpIds = (): Set<string> => readSet();

export const markFollowUpDone = (id: string) => {
  try {
    const set = readSet();
    set.add(id);
    // keep the list bounded
    const arr = Array.from(set).slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
};

export const canMarkRead = (
  n: { id: string; type: string },
  done: Set<string>
): boolean => !requiresFollowUp(n.type) || done.has(n.id);
