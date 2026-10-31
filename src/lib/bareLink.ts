/** A path that is only a uuid, e.g. "/e2fc…aa" (old or mangled client link). */
export const bareUuid = (path: string): string | null => {
  const m = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(path || "");
  return m ? m[1].toLowerCase() : null;
};
