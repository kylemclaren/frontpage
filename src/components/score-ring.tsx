import { cn } from "cn"

/** A small ring showing a 0..1 score as a percentage. `null` means not scored; `pending` means its score is on the way. */
export function ScoreRing({
  value,
  pending = false,
  className,
}: {
  value: number | null
  pending?: boolean
  className?: string
}) {
  const r = 15
  const c = 2 * Math.PI * r
  const pct = value == null ? null : Math.round(value * 100)
  const hot = pct != null && pct >= 70
  return (
    <div
      className={cn(
        "relative grid size-9 shrink-0 place-items-center",
        pending && pct == null && "animate-pulse",
        className,
      )}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-border" />
        {pct != null && (
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(c * pct) / 100} ${c}`}
            className="stroke-brand transition-[stroke-dasharray] duration-500"
          />
        )}
      </svg>
      <span
        className={cn("font-mono text-[11px] font-semibold tabular-nums", hot ? "text-brand" : "text-muted-foreground")}
      >
        {pct ?? "–"}
      </span>
    </div>
  )
}
