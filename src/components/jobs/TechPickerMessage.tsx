export default function TechPickerMessage({ phase, onRetry }: {
  phase: "loading" | "error" | "empty" | "ready";
  onRetry?: () => void;
}) {
  if (phase === "loading") {
    return <p className="text-sm text-muted-foreground" data-testid="tech-picker-loading">Loading technicians…</p>;
  }
  if (phase === "error") {
    return (
      <p className="text-sm" data-testid="tech-picker-error">
        Couldn't load technicians.{" "}
        <button type="button" className="fl-btn-text px-1" onClick={onRetry}>Retry</button>
      </p>
    );
  }
  if (phase === "empty") {
    return <p className="text-sm text-muted-foreground" data-testid="tech-picker-empty">No technicians in this company.</p>;
  }
  return null;
}
