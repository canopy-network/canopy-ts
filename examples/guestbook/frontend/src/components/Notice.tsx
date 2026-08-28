type Tone = "error" | "success" | "info";

const TONES: Record<Tone, string> = {
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  info: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
};

/** A small inline banner for load, success, and error states. */
export function Notice({
  tone,
  children,
  onDismiss,
}: {
  tone: Tone;
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`}
    >
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded px-1 text-current/60 hover:text-current"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
